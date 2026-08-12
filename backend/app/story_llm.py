from __future__ import annotations

import asyncio
from typing import Awaitable, Callable

from app.llm_client import generate_structured
from app.infographic_llm import TEMPLATE_CATALOG, generate_infographic
from app.infographic_models import InfographicDiagram
from app.story_models import (
    STORY_MAX_BEATS,
    STORY_MIN_BEATS,
    NarrationOnly,
    StoryBeat,
    StoryBeatPlan,
    StoryPlan,
    StoryScript,
)

# The content templates (radial_wheel, feature_story, value_proposition, etc.)
# plus title_intro as an available opening-hook beat -- the same addition
# CLASSIFY_SYSTEM_PROMPT makes for single-slide mode, for the same reason:
# title_intro is a legitimate content choice here, unlike agenda (a
# table-of-contents slide, which doesn't fit a spoken narrative).
STORY_TEMPLATE_CATALOG = f"""{TEMPLATE_CATALOG}
- title_intro: a cover/hook slide -- a headline naming the product, a one-line description, and \
a few highlight tags. Good for an opening beat that grabs attention before diving into the \
narrative."""


# Frameworks for getting a story to land its point with a senior-management
# audience -- ported from nraford7/Narrative-Engine's communication-framework
# catalog, trimmed to the ones whose whole mechanism is "make the point land
# for an executive," rather than general-purpose narrative arcs (Hero's
# Journey and the like are a different job: audience engagement, not
# decision-making speed). Each entry's own text tells the model both its
# shape and when to reach for it, the same pattern as
# diagram_slide_rules.DIAGRAM_TYPE_CATALOG.
STORY_FRAMEWORK_CATALOG = """- minto_pyramid: lead with the answer. State the recommendation or conclusion directly in the \
first beat after the minimum context needed to make it make sense -- not as a reveal saved for \
the end. Every beat after that either substantiates the answer with one supporting argument or \
forecloses an objection to it. This is the default choice for a recommendation to senior \
management: they want the bottom line first and will ask for supporting detail only if they need \
it, not sit through a build-up to find out what you're proposing.
- scqa: Situation (the shared, uncontested context, established briefly) -> Complication (the one \
thing that changed, or the problem that makes the situation no longer stable) -> Question (name \
explicitly the question this complication raises -- "so what should we do?") -> Answer (state the \
recommendation directly, then spend the remaining beats substantiating it, not delaying it \
further). Best when the audience needs to feel *why* a decision is suddenly necessary before \
they'll accept the answer -- the complication is what earns their attention.
- pas: Problem (name the concrete cost of inaction) -> Agitate (make the problem's stakes vivid \
and urgent -- what specifically gets worse if nothing changes) -> Solution (the recommendation, \
positioned as the direct resolution to the problem just made urgent). Best when the material's \
biggest risk is that the audience underrates the problem, not that they'd doubt the solution once \
they understood the stakes.
- before_after_bridge: Before (today's state, described in the audience's own terms) -> After (the \
specific future state this product/initiative creates) -> Bridge (what it actually takes to get \
from Before to After -- this is the ask). Best when the value is easiest to grasp as a contrast \
between two concrete states rather than as an abstract argument."""


def _story_plan_prompt(total_minutes: int) -> str:
    return f"""You are a presentation coach helping a product manager build the narrative for a \
live demo to senior executives. Given source material about a product (a generated spec, or any \
uploaded document) and a target demo length, plan the story as a sequence of timed beats -- \
moments in the talk, each backed by one supporting slide.

Available slide templates:
{STORY_TEMPLATE_CATALOG}

Available frameworks -- pick exactly one, the one that best fits this material and this audience, \
and set `framework` to its id:
{STORY_FRAMEWORK_CATALOG}

Rules:
- Pick beat labels that reflect the chosen framework's own structure (e.g. "The Complication", \
"The Answer" for scqa; "Recommendation", "Why It Works" for minto_pyramid) -- not generic labels \
like "Slide 3".
- The point of picking a framework is that the story comes to its point -- do not treat the \
recommendation as a twist to reveal at the end. Every framework above front-loads the answer \
(directly in minto_pyramid, after one beat of context in the others) specifically so senior \
management gets the bottom line early and the rest of the talk earns their confidence in it, \
rather than building suspense toward it.
- Regardless of framework, the arc as a whole MUST establish: (1) why this matters now -- the \
product's relevance, (2) the concrete business value it creates, and (3) what makes it different \
from the alternatives -- these can be woven into whatever beats fit naturally; they don't need to \
be separate beats with those exact names.
- Open with a hook (often title_intro) and close with a clear ask or next step (bullet_summary \
works well for this) that restates the same point the framework already landed early -- the close \
reinforces the answer, it does not introduce it for the first time.
- Each beat needs a `label`, a `template` (one of the ids above), a `topic` (specific enough that \
a separate step can generate that beat's slide from just this topic plus the full PRD), and a \
time range (`start_minute`, `end_minute`) in minutes from the start of the talk.
- Time ranges must be contiguous and non-overlapping, starting at 0, and must sum to exactly \
{total_minutes} minutes. Pace beats for a spoken presentation, not a slide flip -- 2-4 minutes \
each is typical; don't cram in so many beats that none gets enough time to actually say \
something, and don't leave so few that any one beat runs long.
- Number of beats should fit the time budget: {STORY_MIN_BEATS}-{STORY_MAX_BEATS}, adjusted for \
{total_minutes} minutes (a short demo needs fewer beats than a long one).
- `title` is a short 2-6 word name for the whole story/talk.
- Base everything on what the source material actually describes. Do not invent claims, metrics, \
or differentiators that aren't implied by the material.
"""


async def plan_story(prd_text: str, total_minutes: int, prompt: str) -> StoryPlan:
    user_message = f"Source material:\n{prd_text}"
    if prompt:
        user_message += f"\n\nAdditional instructions:\n{prompt}"
    return await generate_structured(_story_plan_prompt(total_minutes), user_message, StoryPlan)


NARRATION_SYSTEM_PROMPT = """You are a presentation coach writing spoken narration for one beat \
of a live product demo to senior executives. Given the beat's label, its time budget, the story's \
chosen framework, the slide that will be on screen during this beat, and the product's full \
source material for context, write natural, confident spoken narration -- not bullet points, not \
a slide read aloud, but what a skilled presenter would actually say out loud.

Rules:
- Write in first person, conversational spoken English, with natural transitions -- imagine this \
is a transcript of someone talking, not a written memo.
- If this beat is the one where the framework's answer/recommendation lands (e.g. the "Answer" \
beat in scqa, or the opening beat in minto_pyramid), state it directly and confidently -- "we \
should do X" or "the recommendation is X," not hedged with "we might consider" or "one option \
could be." Senior management reads hedging on the recommendation as a lack of conviction, not \
appropriate humility.
- Budget roughly 130 spoken words per minute of the beat's duration, so the narration actually \
fits the time given -- don't write a 30-second beat's worth of words for a 4-minute beat, or the \
reverse.
- Reference what's on the slide naturally ("as you can see here...") without literally reading \
its bullet points aloud.
- End on a note that transitions naturally toward the next beat, unless this is the closing beat.
- Base every claim on the source material. Do not invent a metric, quote, or claim that isn't in \
the material.
"""


async def generate_beat_narration(
    prd_text: str, framework: str, beat_plan: StoryBeatPlan, slide: InfographicDiagram
) -> str:
    duration = beat_plan.end_minute - beat_plan.start_minute
    user_message = (
        f"Source material:\n{prd_text}\n\n"
        f"Story framework: {framework}\n"
        f'Beat: "{beat_plan.label}" ({duration:.1f} minutes, minute {beat_plan.start_minute:.1f} '
        f"to {beat_plan.end_minute:.1f} of the talk)\n"
        f"Beat's topic brief: {beat_plan.topic}\n\n"
        f"Slide on screen during this beat (JSON):\n{slide.model_dump_json()}"
    )
    parsed = await generate_structured(NARRATION_SYSTEM_PROMPT, user_message, NarrationOnly)
    return parsed.narration


async def generate_story_beat(prd_text: str, framework: str, prompt: str, beat_plan: StoryBeatPlan) -> StoryBeat:
    """Slide first, then narration -- narration is written to reference the
    slide's ACTUAL finished content (see generate_beat_narration's prompt),
    not just the plan's one-line topic brief, so the two calls can't run
    concurrently within a beat even though different beats do (in
    generate_story below)."""
    scoped_prompt = f"This slide should focus specifically on: {beat_plan.topic}"
    if prompt:
        scoped_prompt = f"{prompt}\n\n{scoped_prompt}"
    slide = await generate_infographic(beat_plan.template, prd_text, scoped_prompt)
    narration = await generate_beat_narration(prd_text, framework, beat_plan, slide)
    return StoryBeat(
        label=beat_plan.label,
        start_minute=beat_plan.start_minute,
        end_minute=beat_plan.end_minute,
        narration=narration,
        slide=slide,
    )


async def _generate_indexed_beat(
    i: int, prd_text: str, framework: str, prompt: str, beat_plan: StoryBeatPlan
) -> tuple[int, StoryBeat]:
    beat = await generate_story_beat(prd_text, framework, prompt, beat_plan)
    return i, beat


async def generate_story(
    prd_text: str,
    project_id: str | None,
    project_name: str,
    total_minutes: int,
    prompt: str,
    plan: StoryPlan,
    on_beat_done: Callable[[int, int], Awaitable[None]] | None = None,
) -> StoryScript:
    # Independent per-beat calls run concurrently across beats (same
    # as_completed pattern as generate_deck), even though within a beat
    # narration must wait on that beat's own slide.
    total = len(plan.beats)
    tasks = [
        asyncio.ensure_future(_generate_indexed_beat(i, prd_text, plan.framework, prompt, beat_plan))
        for i, beat_plan in enumerate(plan.beats)
    ]

    results: list[StoryBeat | None] = [None] * total
    completed = 0
    for task in asyncio.as_completed(tasks):
        i, beat = await task
        results[i] = beat
        completed += 1
        if on_beat_done:
            await on_beat_done(completed, total)

    beats = [beat for beat in results if beat is not None]
    return StoryScript(
        title=plan.title,
        total_minutes=total_minutes,
        framework=plan.framework,
        source_project_id=project_id,
        source_project_name=project_name,
        beats=beats,
    )
