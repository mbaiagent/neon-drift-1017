# NEON DRIFT 1017

A browser racing game with **zero dependencies and zero assets**.

Every pixel and every sound — the road, the cars, the palm trees, the billboards, the striped sun, the engine note and the soundtrack — is generated at runtime. No images, no 3D models, no audio files, no libraries.

Open `index.html` and play. No server, no build step, no network required.

![Racing](screenshots/03-race.png)

| Title screen | Starting grid | Nitro |
| --- | --- | --- |
| ![Title](screenshots/01-menu.png) | ![Grid](screenshots/02-start.png) | ![Nitro](screenshots/04-boost.png) |

Portrait mobile is fully playable as well:

<img src="screenshots/05-mobile.png" width="280" alt="Mobile layout">

## Controls

| Key | Action |
| --- | --- |
| `↑` / `W` | Accelerate |
| `↓` / `S` | Brake |
| `←` `→` / `A` `D` | Steer |
| `SPACE` | Nitro (N₂O) |
| `ESC` / `P` | Pause |
| `M` | Toggle music |
| `R` | Restart |
| `F` | Show FPS / frame time |

Gamepad (left stick, RT/LT, A for nitro) and touch controls are supported.

## Gameplay

* Sunset coast circuit, 3 laps, 6 cars. You start last, on P6.
* Corners throw the car outward — counter-steer early. Hard steering at speed drops you into a drift (tyre screech, smoke, body roll).
* Running wide kills your speed and kicks up dust; clipping a guard rail scrubs speed and throws sparks. An `OFF TRACK` warning flashes while you're off the road.
* Nitro drains while held and recharges on its own. Save it for corner exits.
* AI rivals run their own lines and slow down for corners. Overtaking flashes the position chip.
* Live lap time, best lap, position, a schematic minimap and an analogue dial with gear and digital speed.

## How it works

* **Pseudo-3D projection.** The circuit is 3,984 segments long. Each frame every segment is projected into screen space, sorted back-to-front and clipped against the highest horizontal line drawn so far. Curves accumulate a lateral offset, hills raise the road, and distance fog fades the world into the horizon colour.
* **Track generation.** `addRoad / addCurve / addHill / addSCurves` compose a closed loop; the final section eases the elevation back to zero so the start/finish seam is invisible.
* **Pre-baked vector art.** Cars, palms, neon pylons, billboards and gates are drawn once into offscreen canvases with `Canvas2D` paths and shadows, then blitted as sprites. The player's car is a pre-rendered sheet per paint colour; brake glow, nitro jets and heat haze are layered additively at runtime.
* **Procedural audio.** WebAudio synthesises the engine (two detuned saws, a sub oscillator and a resonant low-pass tracking RPM), wind, tyre and gravel noise, the crash impact and the nitro whoosh — plus a 112 BPM synthwave loop with kick, snare, bass and arpeggio.
* **Performance.** Roughly 1–2 ms per frame at 1600×1000 including the HUD and minimap, measured in-browser, which leaves plenty of headroom for 60 fps on modest hardware.

## Project layout

```
index.html   markup, HUD, menu and results panels
style.css    neon UI, layout and animations
game.js      renderer, track, physics, AI, audio and UI logic
```

## Notes

* The wordmark uses Google Fonts. If it can't be reached the UI falls back to system fonts and the game still runs completely offline.
* Every billboard and gate on the circuit is advertising the same thing this game was built with.
