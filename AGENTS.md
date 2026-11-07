# Heavy Rig

- Browser-only standalone game; no backend, desktop, or Steam setup.
- Use Bun 1.3.14, its native HTML dev server, bundler, test runner, and file APIs.
- Keep gameplay under `src/`, tests under `tests/`, and static files under `public/`.
- Preserve fixed-step simulation, independent turret aim, persistent throttle, and keyboard/gamepad/touch controls.
- Use strict TypeScript without `any`, non-null assertions, or unchecked casts. Prefer function expressions and tabs.
- Use the ECSpresso skill for ECS behavior changes. Prefer published plugin APIs.
- Run `bun run check` and verify visible changes against a production preview.
- Report simulated inputs separately from physical controller/touch, audio, performance, and balance acceptance.
- Add or change tests only for meaningful regression protection; ask the owner if their value is uncertain.
- Keep assets relative, saves namespaced, and unrelated edits intact.
- Deliver through PRs against protected `master`; never bypass protection or merge without every required check succeeding for the current head.
- Release task-created processes and browser tabs; preserve shared/user resources.
