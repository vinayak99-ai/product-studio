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


def _story_plan_prompt(total_minutes: int) -> str:
    return f"""You are a presentation coach helping a product manager build the narrative for a \
live demo to senior executives. Given source material about a product (a generated spec, or any \
uploaded document) and a target demo length, plan the story as a sequence of timed beats -- \
moments in the talk, each backed by one supporting slide.

Available slide templates:
{STORY_TEMPLATE_CATALOG}

Rules:
- Choose whatever narrative structure fits this product best (e.g. Situation -> Complication -> \
Resolution, before/after, a customer's journey) -- there is no fixed framework to follow. Pick \
beat labels that reflect the structure you chose (e.g. "Why Now", "The Problem", "How It Works"), \
not generic labels like "Slide 3".
- Regardless of structure, the arc as a whole MUST establish: (1) why this matters now -- the \
product's relevance, (2) the concrete business value it creates, and (3) what makes it different \
from the alternatives -- these can be woven into whatever beats fit naturally; they don't need to \
be separate beats with those exact names.
- Open with a hook (often title_intro) and close with a clear ask or next step (bullet_summary \
works well for this).
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
of a live product demo to senior executives. Given the beat's label, its time budget, the slide \
that will be on screen during this beat, and the product's full source material for context, \
write natural, confident spoken narration -- not bullet points, not a slide read aloud, but what \
a skilled presenter would actually say out loud.

Rules:
- Write in first person, conversational spoken English, with natural transitions -- imagine this \
is a transcript of someone talking, not a written memo.
- Budget roughly 130 spoken words per minute of the beat's duration, so the narration actually \
fits the time given -- don't write a 30-second beat's worth of words for a 4-minute beat, or the \
reverse.
- Reference what's on the slide naturally ("as you can see here...") without literally reading \
its bullet points aloud.
- End on a note that transitions naturally toward the next beat, unless this is the closing beat.
- Base every claim on the source material. Do not invent a metric, quote, or claim that isn't in \
the material.
"""


async def generate_beat_narration(prd_text: str, beat_plan: StoryBeatPlan, slide: InfographicDiagram) -> str:
    duration = beat_plan.end_minute - beat_plan.start_minute
    user_message = (
        f"Source material:\n{prd_text}\n\n"
        f'Beat: "{beat_plan.label}" ({duration:.1f} minutes, minute {beat_plan.start_minute:.1f} '
        f"to {beat_plan.end_minute:.1f} of the talk)\n"
        f"Beat's topic brief: {beat_plan.topic}\n\n"
        f"Slide on screen during this beat (JSON):\n{slide.model_dump_json()}"
    )
    parsed = await generate_structured(NARRATION_SYSTEM_PROMPT, user_message, NarrationOnly)
    return parsed.narration


async def generate_story_beat(prd_text: str, prompt: str, beat_plan: StoryBeatPlan) -> StoryBeat:
    """Slide first, then narration -- narration is written to reference the
    slide's ACTUAL finished content (see generate_beat_narration's prompt),
    not just the plan's one-line topic brief, so the two calls can't run
    concurrently within a beat even though different beats do (in
    generate_story below)."""
    scoped_prompt = f"This slide should focus specifically on: {beat_plan.topic}"
    if prompt:
        scoped_prompt = f"{prompt}\n\n{scoped_prompt}"
    slide = await generate_infographic(beat_plan.template, prd_text, scoped_prompt)
    narration = await generate_beat_narration(prd_text, beat_plan, slide)
    return StoryBeat(
        label=beat_plan.label,
        start_minute=beat_plan.start_minute,
        end_minute=beat_plan.end_minute,
        narration=narration,
        slide=slide,
    )


async def _generate_indexed_beat(
    i: int, prd_text: str, prompt: str, beat_plan: StoryBeatPlan
) -> tuple[int, StoryBeat]:
    beat = await generate_story_beat(prd_text, prompt, beat_plan)
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
        asyncio.ensure_future(_generate_indexed_beat(i, prd_text, prompt, beat_plan))
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
        source_project_id=project_id,
        source_project_name=project_name,
        beats=beats,
    )
