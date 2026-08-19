"""NetworkX graph builder + analysis over the CONFIRMED SystemMapGraph only
-- extraction drafts and merge candidates aren't trustworthy enough to
analyze and never flow through here directly (see system_map_models.py's
"Graph analysis results" section docstring)."""

from __future__ import annotations

import networkx as nx

from app.system_map_models import (
    CentralityResult,
    CycleReport,
    DataFlowEdge,
    ExtractedNodeDraft,
    ExtractionDraft,
    MergeCandidate,
    OrphanReport,
    PathResult,
    PiiFlowResult,
    SystemMapGraph,
    SystemNode,
)

_CRITICALITY_RANK = {"high": 3, "medium": 2, "low": 1}


def assemble_graph_from_drafts(
    drafts: list[ExtractionDraft], merge_decisions: list[MergeCandidate]
) -> SystemMapGraph:
    """Builds a PROPOSED graph from every given extraction draft, folding
    together node names the human confirmed as duplicates (Review point 2)
    via union-find over names. The route layer is responsible for only
    passing reviewed drafts in here -- this function doesn't itself check
    `draft.reviewed`. Pure and deterministic: the same drafts + decisions
    always produce the same graph (same node/edge ids in the same order),
    so re-running it after reviewing one more document is predictable
    rather than a fresh shuffle. Never saved as the confirmed graph
    directly -- see routes/system_map.py's /graph/build vs /graph/confirm."""
    parent: dict[str, str] = {}

    def find(name: str) -> str:
        parent.setdefault(name, name)
        while parent[name] != name:
            parent[name] = parent[parent[name]]
            name = parent[name]
        return name

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for decision in merge_decisions:
        if decision.decision == "merge":
            union(decision.node_a_name, decision.node_b_name)

    groups: dict[str, list[ExtractedNodeDraft]] = {}
    for draft in drafts:
        for n in draft.nodes:
            groups.setdefault(find(n.name), []).append(n)

    # Names that only ever appear as an edge endpoint, with no matching
    # node draft, become implicit "other"-typed nodes rather than silently
    # dropping the edge -- this app never drops extracted data without a
    # human seeing it first.
    for draft in drafts:
        for e in draft.edges:
            for name in (e.source_system_name, e.target_system_name):
                groups.setdefault(find(name), [])

    node_ids: dict[str, str] = {}
    nodes: list[SystemNode] = []
    for i, (root, group) in enumerate(sorted(groups.items()), start=1):
        node_id = f"SYS-{i}"
        node_ids[root] = node_id
        if group:
            canonical_name = group[0].name
            aliases = sorted({n.name for n in group if n.name != canonical_name})
            node_type = next((n.type for n in group if n.type != "other"), group[0].type)
            owning_team = next((n.owning_team for n in group if n.owning_team), "")
            criticality = max(
                (n.criticality for n in group), key=lambda c: _CRITICALITY_RANK[c], default="medium"
            )
            citations = [n.citation for n in group]
        else:
            canonical_name = root
            aliases, node_type, owning_team, criticality, citations = [], "other", "", "medium", []
        nodes.append(
            SystemNode(
                id=node_id,
                name=canonical_name,
                type=node_type,
                owning_team=owning_team,
                criticality=criticality,
                aliases=aliases,
                citations=citations,
            )
        )

    edges: list[DataFlowEdge] = []
    for draft in drafts:
        for e in draft.edges:
            source_id = node_ids.get(find(e.source_system_name))
            target_id = node_ids.get(find(e.target_system_name))
            if source_id is None or target_id is None:
                continue  # unreachable given the edge-endpoint backfill above
            edges.append(
                DataFlowEdge(
                    id=f"FLOW-{len(edges) + 1}",
                    source_system_id=source_id,
                    target_system_id=target_id,
                    fields=e.fields,
                    pii_fields=e.pii_fields,
                    transport=e.transport,
                    frequency=e.frequency,
                    format=e.format,
                    purpose=e.purpose,
                    citations=[e.citation],
                )
            )

    return SystemMapGraph(nodes=nodes, edges=edges)


def build_graph(graph: SystemMapGraph) -> nx.MultiDiGraph:
    """One system = one node, keyed by SystemNode.id (never by name -- name
    collisions across systems are exactly what the merge-review step exists
    to resolve before a graph is ever confirmed). One data flow = one
    directed edge, keyed by DataFlowEdge.id; MultiDiGraph because two
    systems can legitimately exchange more than one distinct feed."""
    g = nx.MultiDiGraph()
    for node in graph.nodes:
        g.add_node(
            node.id,
            name=node.name,
            type=node.type,
            criticality=node.criticality,
            owning_team=node.owning_team,
        )
    for edge in graph.edges:
        g.add_edge(
            edge.source_system_id,
            edge.target_system_id,
            key=edge.id,
            id=edge.id,
            fields=edge.fields,
            pii_fields=edge.pii_fields,
            transport=edge.transport,
            frequency=edge.frequency,
            purpose=edge.purpose,
        )
    return g


def trace_pii_flow(graph: SystemMapGraph, field: str) -> PiiFlowResult:
    """Every edge that carries `field` as PII, plus every system reachable
    downstream from one of those edges -- i.e. everywhere this field could
    end up once it enters the graph, not just its immediate recipients."""
    matching_edges = [e for e in graph.edges if field in e.pii_fields]
    g = build_graph(graph)

    reachable: set[str] = set()
    for e in matching_edges:
        if e.target_system_id not in g:
            continue
        reachable.add(e.target_system_id)
        reachable |= nx.descendants(g, e.target_system_id)

    return PiiFlowResult(field=field, edges=matching_edges, reachable_system_ids=sorted(reachable))


def find_cycles(graph: SystemMapGraph) -> CycleReport:
    """Feeds that loop back into themselves -- not inherently wrong (a
    reconciliation feed returning to its origin is often intentional), but
    always worth a human's attention given this session's Review point
    conventions, since an accidental cycle is a real operational risk."""
    g = build_graph(graph)
    cycles = [cycle for cycle in nx.simple_cycles(g) if len(cycle) > 1 or _has_self_loop(g, cycle[0])]
    return CycleReport(cycles=cycles)


def _has_self_loop(g: nx.MultiDiGraph, node_id: str) -> bool:
    return g.has_edge(node_id, node_id)


def find_orphans(graph: SystemMapGraph) -> OrphanReport:
    """Systems with no edges at all (mentioned in a document but never
    actually connected to anything), and edges referencing a system id no
    longer present in the graph (shouldn't happen through normal use, but
    worth surfacing if a node was ever deleted without its edges)."""
    node_ids = {n.id for n in graph.nodes}
    connected: set[str] = set()
    for e in graph.edges:
        connected.add(e.source_system_id)
        connected.add(e.target_system_id)

    isolated = sorted(node_ids - connected)
    dangling = [
        e.id for e in graph.edges if e.source_system_id not in node_ids or e.target_system_id not in node_ids
    ]
    return OrphanReport(isolated_system_ids=isolated, dangling_edge_ids=dangling)


def find_paths(
    graph: SystemMapGraph, source_system_id: str, target_system_id: str, cutoff: int | None = None
) -> PathResult:
    """Every simple (no-repeated-node) path from source to target -- "how
    does data actually get from A to Z," which can be more than one route
    across 30 interconnected systems. `cutoff` bounds path length so a
    densely-connected graph can't blow up combinatorially."""
    g = build_graph(graph)
    if source_system_id not in g or target_system_id not in g:
        return PathResult(source_system_id=source_system_id, target_system_id=target_system_id, paths=[])

    paths = list(nx.all_simple_paths(g, source_system_id, target_system_id, cutoff=cutoff))
    return PathResult(source_system_id=source_system_id, target_system_id=target_system_id, paths=paths)


def compute_centrality(graph: SystemMapGraph) -> CentralityResult:
    """Degree centrality -- the systems most connected to the rest of the
    mesh, i.e. candidate hubs / single points of failure. Degree (not
    betweenness) deliberately, to stay O(n) and legible at this scale;
    revisit if 30 systems ever grows into hundreds."""
    g = build_graph(graph)
    if g.number_of_nodes() == 0:
        return CentralityResult(scores={})
    return CentralityResult(scores=nx.degree_centrality(g))
