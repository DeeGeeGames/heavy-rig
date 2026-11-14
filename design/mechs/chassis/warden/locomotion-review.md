# Warden accepted locomotion

`approved-locomotion.json` freezes the selected walking reference, approved
longer-stride run, and selected dedicated backward gait. The owner accepted the
current geometry and deferred any remaining fine-tuning. Stage 5 is complete
for this reviewed prototype motion envelope. No game speeds or assets change.

## Retained motions

- Walk: the selected normal-rate motion, formerly called run v3; 0.9-second
  cycle and 0.32 source units of travel.
- Run: 0.9-second cycle and 0.64 source units of travel, with two 0.108-second
  suspension intervals. The feet recover early and the pelvis rises during flight.
- Backward: a separately authored 1-second cycle, -0.266667 source units of
  travel, and 60% stance per foot. Continuous ground support, lower lift and
  restrained body motion distinguish it from reversed forward playback.

The accepted interface master's geometry, original larger axles and shin-owned
front guards are preserved. Ankle flexion occurs during swing; planted feet stay
flat. An IK solve maintains leg lengths and piston attachments/stroke. Baked GLB
clips preserve the authoring motion without Blender constraints at runtime.

## Validation

The actual GLBs pass 55/109/121 sampled comparisons respectively, covering feet,
ankle pitch, body/guard matrices, root travel and actuator direction/attachment.
Both run feet visibly clear the ground during suspension. Backward travel is
negative with no unsupported samples. Independent 480 Hz review found no blocking
issues; small interpolation deviations remain (run floor/stance about
0.0000342/0.0000345 source units; backward about 0.00000325/0.00000317).
All 426 existing tests, typecheck, lint and build passed during animation work.

These are accepted visible prototype results, not proof of zero mesh
intersections, unrestricted joint limits or in-game performance. Motion-study
units and cadence do not alter gameplay balance.

## Reproduction and remaining work

Follow `scripts/mech-design/blender/README.md`. Current profile settings are
`--speed 4` (walk), `--profile suspended-run --speed 8` (run), and
`--profile backward-walk --speed 3` (backward). Derive into separate ignored
candidate directories; approved checkpoint bytes remain unchanged.

Stage 6 needs exact muzzle exits, aim-range clearance and refreshed A/B/C/empty
component exports using these motions. Stage 7 needs an acceptable optimized
asset and measured budget. Runtime direction/speed transitions, independent
combat aiming, turning and terrain belong to later integration. The reversed
walk comparison and rejected speed/stride trials are not retained checkpoints.
