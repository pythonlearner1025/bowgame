# Code style

Code is read far more often than it is written. Optimize for a human reader six months from
now who has not seen the code. Coding agents must follow this file; it wins over any model's
default habits.

## Formatting

Formatting is Prettier's job, not a matter of taste. The project uses a 100-character print
width, two-space indentation, semicolons, single quotes, trailing commas, parentheses around
arrow-function parameters, and spaces inside object braces. Run `npm run format` to rewrite files
and `npm run lint` to check them.

## Statements and control flow

- Put one idea and one statement on each line.
- Do not use comma sequences or chained assignments.
- Do not use `condition && call()` as a statement.
- Do not nest ternaries. A ternary may only select between two simple values.
- Use braces for every `if`, `else`, `for`, and `while`, including one-line bodies.
- Prefer early returns to deep nesting. Do not nest more than three levels.

## Size limits

- Keep lines at or below 100 characters.
- Keep functions at or below 60 lines, excluding blank lines and comments. ESLint warns beyond
  this limit.
- Keep files at or below 400 lines, excluding blank lines and comments. ESLint warns beyond this
  limit; split large files by responsibility.
- Use at most four parameters. Beyond that, use an options object.

## Names

Use full words. The only permitted abbreviations are `id`, `url`, `dt` (delta time), `x`, `y`,
`z`, and `w` components, `i`, `j`, and `k` loop indices, `min`, `max`, and `ms`. Boolean names
read as predicates, such as `isGrounded`, `hasTarget`, and `canJump`. Function names are verbs,
such as `computeArrowDrop` and `applyDamage`. Classes and types are nouns.

Constants use `UPPER_SNAKE_CASE`. Constants with units include those units in the name, such as
`DRAW_SECONDS`, `ARROW_SPEED_METERS_PER_SECOND`, and `EYE_HEIGHT_METERS`. Do not use other
single-letter identifiers or numeric suffixes such as `p2` and `tmp3`.

## Tuning values

Do not put magic numbers inside logic. Group tuning values at the top of their module as named
constants. Give each one a one-line comment explaining what it controls and why it has that
value. Gameplay tuning values must not change during readability-only work.

## Comments and documentation

Comments explain why, invariants, units, coordinate conventions (Y up, meters, radians, and tick
rate), and non-obvious mathematics by naming the formula. They never restate obvious code.

Every file starts with a short header comment explaining what the module owns and what it
deliberately does not own. Every exported function, class, and type, and every non-trivial method,
has a JSDoc block with a one-sentence purpose, each parameter's meaning and units, the return
value, and side effects. Hot-path micro-optimizations such as scratch vectors and manual inlining
are allowed only when a comment states the measured reason.

## Types and APIs

- Exported functions have explicit return types.
- Do not use `any`; accept `unknown` and narrow it.
- Model protocol messages as discriminated unions.
- Do not use a non-null assertion (`!`) without a comment explaining why the value cannot be null.

## Responsibilities and errors

Functions do one thing. Separate computing from mutation when practical. Avoid boolean flag
parameters; use an options object or two named functions. Never swallow errors: log them with
context or rethrow them, and never leave a catch block empty.

## Tests

Tests read as specifications. Give each test a full-sentence name. Separate arrange, act, and
assert sections with blank lines. Avoid clever helpers that hide the scenario.

## Forbidden idioms

- `a && b()` statements
- `x = y = z`
- `~~x`, `x | 0`, and `!!x`; use `Math.trunc`, `Math.floor`, or `Boolean`
- IIFEs used only for scoping
- chained ternaries
- dense one-liners that combine assignment and condition
- single-letter lambdas beyond `(a, b) => a - b` sorts
- regular expressions without a comment explaining the pattern
- bit flags without a comment explaining the representation
- abbreviations invented for one file
- unrelated declarations in one `const` statement
- long positional parameter lists of numbers
