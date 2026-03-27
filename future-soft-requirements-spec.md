# Future Soft Requirements Spec

## Purpose

This note captures future requirement fields the app may support later, even though the backend cannot reliably verify them from Bungie or from in-game state.

These should be treated as **soft requirements**, not hard-gated or Bungie-verified requirements.

## Core rule

For these fields:

- the host can describe what they want
- the applicant can self-report what they have
- the backend should store and filter on them
- the backend should **not** claim they are verified
- the backend should **not** auto-enforce them as official truth

If we add these later, they should behave more like structured expectations and self-reported metadata than anti-cheat validation.

## Future requirement ideas

### 1. Character level

What it means:

- host wants applicants at or above some experience level

Suggested data shape:

- `min_character_level integer`

Suggested display:

- `Level 20+`
- `Level 35+ preferred`

Notes:

- useful as a filter and expectation signal
- should be labeled as host-defined unless we ever get a verifiable source

### 2. Shield level

What it means:

- host wants applicants to have a minimum shield tier

Suggested data shape:

- `min_shield_level smallint`

Expected range:

- `0`
- `1`
- `2`
- `3`

Suggested display:

- `Shield level 2+`
- `Shield level 3 required`

Notes:

- easy to model as a small bounded enum/integer
- still not verifiable from current backend data sources

### 3. Loadout value

What it means:

- host wants players to bring a minimum total loadout strength/value

Suggested data shape:

- `min_loadout_value integer`

Suggested display:

- `Loadout value 1200+`
- `High-value loadout preferred`

Notes:

- should be treated as a self-reported or honor-system field
- if the game exposes no trustworthy source, this remains descriptive only

### 4. Consumables count

What it means:

- host wants players to bring a target amount of resources, for example:
  - `6 health packs`
  - `6 shield charges`

Suggested data shape:

- `required_health_packs integer`
- `required_shield_charges integer`

Suggested display:

- `Bring 6 health packs and 6 shield charges`
- `Full consumables expected`

Important limitation:

- this is probably the least enforceable requirement of the group
- even in-game, there may be no reliable way to validate it from the backend
- this should almost certainly remain descriptive text plus optional numeric fields for filtering

### 5. Shell type

What it means:

- host wants a specific shell/class/archetype composition

Suggested data shape:

- `allowed_shells text[]`
- or normalized tags such as `shell:void`, `shell:tank`, `shell:scout`

Suggested display:

- `Looking for 1 support shell`
- `Only tank/survival shells`
- `Any shell type`

Notes:

- this is likely better modeled as a controlled vocabulary if shell names are stable
- if shell names are still changing, use tags first and normalize later

## Recommended product behavior

### Host side

- let hosts add these as structured optional fields
- also keep a free-text `requirement_text` field for nuance
- render them as expectations, not system-verified facts

### Applicant side

- allow applicants to self-report matching values later if profile metadata exists
- allow hosts to review applicants manually
- do not auto-reject solely based on self-reported mismatch unless product explicitly chooses that behavior later

### Search and filtering

- allow party-list filtering on these fields
- keep filters clearly labeled as host requirements
- do not imply the backend has confirmed the applicant meets them

## Suggested implementation approach

The simplest future extension is:

1. Add a few normalized optional columns for common numeric requirements.
2. Keep shell/type values as tags or a controlled list.
3. Keep `requirement_text` for anything too fuzzy or not worth normalizing yet.

Example future columns on `parties`:

```sql
alter table parties
  add column min_character_level integer,
  add column min_shield_level smallint,
  add column min_loadout_value integer,
  add column required_health_packs integer,
  add column required_shield_charges integer;
```

Example shell tags:

- `shell:assault`
- `shell:support`
- `shell:tank`

## UX wording recommendation

Use wording like:

- `Host requirement`
- `Host preference`
- `Self-reported`
- `Not verified`

Avoid wording like:

- `Verified requirement`
- `Guaranteed`
- `System confirmed`

## What not to do

- do not block join based on values the backend cannot truly verify unless that behavior is clearly labeled as self-reported gating
- do not badge these values as Bungie-verified
- do not over-model every possible gear/consumable detail too early
- do not remove the free-text requirement field just because structured fields exist

## Recommended next step later

When this feature becomes a priority, add:

1. a small set of normalized numeric fields
2. shell tags or a controlled shell enum
3. clear UI labels showing these are host-defined or self-reported
4. filtering support in party discovery
