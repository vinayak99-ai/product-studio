import { useRef } from "react"
import { CheckSquare, Plus, X } from "lucide-react"
import type { AcceptanceTest } from "@/features/spec-builder/lib/types"
import { useToast } from "@/hooks/use-toast"
import { useViewMode } from "@/features/spec-builder/hooks/view-mode"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Section } from "@/features/spec-builder/components/Section"
import { EditableBlock } from "@/features/spec-builder/components/EditableBlock"

interface TestCaseListProps {
  items: AcceptanceTest[]
  onChange: (items: AcceptanceTest[]) => void
}

function nextId(items: AcceptanceTest[]): string {
  const numbers = items
    .map((item) => {
      const match = item.id.match(/(\d+)\s*$/)
      return match ? parseInt(match[1], 10) : 0
    })
    .filter((n) => !Number.isNaN(n))
  const next = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1
  return `AT-${String(next).padStart(3, "0")}`
}

// Test cases ARE the FR acceptance tests -- there is no separate freestanding
// "success criteria" concept. Each one is keyed to a functional requirement
// by fr_id, so this can't reuse IdentifiedList's flat {id, text} shape.
export function TestCaseList({ items, onChange }: TestCaseListProps) {
  const toast = useToast()
  const mode = useViewMode()
  const latest = useRef({ items, onChange })
  latest.current = { items, onChange }

  function updateItem(index: number, patch: Partial<AcceptanceTest>) {
    const next = [...items]
    next[index] = { ...next[index], ...patch }
    onChange(next)
  }

  function removeItem(index: number) {
    const removed = items[index]
    onChange(items.filter((_, i) => i !== index))
    toast({
      title: `${removed.id} removed`,
      description: removed.title || undefined,
      action: {
        label: "Undo",
        onClick: () => {
          const { items: current, onChange: change } = latest.current
          const next = [...current]
          next.splice(Math.min(index, next.length), 0, removed)
          change(next)
        },
      },
    })
  }

  function addItem() {
    const id = nextId(items)
    onChange([...items, { id, fr_id: "", title: "", given: "", when: "", then: "" }])
  }

  return (
    <Section id="test-cases" title="Test Cases" icon={CheckSquare} count={items.length}>
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No test cases yet. These are drafted per functional requirement, as acceptance tests.
        </p>
      )}
      {items.map((item, i) => (
        <EditableBlock
          key={i}
          label={item.id}
          read={
            <div className="flex flex-col gap-1 py-0.5">
              <div className="flex items-baseline gap-2">
                <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{item.id}</span>
                {item.fr_id && (
                  <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                    verifies {item.fr_id}
                  </Badge>
                )}
                <span className="min-w-0 text-sm font-medium leading-relaxed">
                  {item.title || <span className="text-muted-foreground italic">(untitled)</span>}
                </span>
              </div>
              {(item.given || item.when || item.then) && (
                <p className="pl-16 text-sm leading-relaxed text-muted-foreground">
                  Given {item.given || "…"}, when {item.when || "…"}, then {item.then || "…"}
                </p>
              )}
            </div>
          }
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{item.id}</span>
              <Input
                className="w-28 shrink-0 font-mono text-xs"
                value={item.fr_id}
                placeholder="FR-001"
                onChange={(e) => updateItem(i, { fr_id: e.target.value })}
              />
              <Input
                value={item.title}
                placeholder="Test title"
                onChange={(e) => updateItem(i, { title: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeItem(i)}
                aria-label="Remove test case"
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2 pl-[4.5rem]">
              <Input
                value={item.given}
                placeholder="Given…"
                onChange={(e) => updateItem(i, { given: e.target.value })}
              />
              <Input
                value={item.when}
                placeholder="When…"
                onChange={(e) => updateItem(i, { when: e.target.value })}
              />
              <Input
                value={item.then}
                placeholder="Then…"
                onChange={(e) => updateItem(i, { then: e.target.value })}
              />
            </div>
          </div>
        </EditableBlock>
      ))}
      {mode === "edit" && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={addItem}>
          <Plus className="size-4" /> Add
        </Button>
      )}
    </Section>
  )
}
