# DTX 房间裁剪 — Shader 数据流图 Prompt

**Task slug**: dtx-room-clip-shader-data-flow
**Timestamp**: 20260523-111500
**Mode**: B
**Target**: PNG 1:1 technical memory layout diagram

---

## Prompt

A high-density, editorial technical diagram on warm cream background (#f7f7f4), showing how room clipping data flows from CPU memory → GPU DataTexture → fragment shader. Style: Linear/Vercel/Notion engineering blog diagram. 2D vector style with crisp boxes, hairline borders, mono-font code. NOT a 3D illustration.

**Top title:**
- Bold: **"DTX Shader 数据流 · DataTexture 内存布局"**
- Subtitle muted grey: **"CPU memory → GPU texture → fragment shader fetch"**

**Layout: 3 horizontal zones, each labeled at the left margin.**

---

### Zone 1 — CPU MEMORY (top, ~25% height)

Label at left in muted grey small caps: **"1 · CPU MEMORY"**

A horizontal row of 3 rectangular "Room object" cards (rounded corners, white bg, hairline border):

Card A (light blue bg #dce6f5):
- Header: **"Room A · mode=AABB"**
- Pseudo-code inside in mono:
```
aabb_min: [0,0,0]
aabb_max: [10,5,3]
```

Card B (slightly darker blue #c5d4e8):
- Header: **"Room B · mode=CONVEX_HULLS"**
- Pseudo-code:
```
hulls: [
  { planes: [12 planes] },
  { planes: [8 planes] }
]
```

Card C (lavender #e0d6f0):
- Header: **"Room C · mode=SDF"**
- Pseudo-code:
```
resolution: 128³
sdf_layer: 0
```

Three downward arrows from each card to zone 2 below.

---

### Zone 2 — GPU DATATEXTURE LAYOUT (middle, ~50% height) — THIS IS THE HERO ZONE

Label at left: **"2 · GPU DATATEXTURE"**

Show TWO stacked horizontal "ruler-like" texture strips representing memory layout, each strip is a long horizontal rectangle divided into colored tiles. Each tile represents 1 texel. Use texel-level grid lines.

**Strip 1 — uClipPlanesTexture (RGBA32F):**
- Strip header label above: **"uClipPlanesTexture (RGBA32F)"** with width annotation **"width = 2048 texels"**
- Show first ~30 texels divided into colored regions:
  - First 6 texels filled with light blue (#dce6f5) labeled below: **"Room A · AABB 6-plane"**
  - Next 12 texels darker blue (#c5d4e8) labeled: **"Room B · hull 0 (12 plane)"**
  - Next 8 texels same darker blue labeled: **"Room B · hull 1 (8 plane)"**
  - Then "..." indicating continuation
- Above one of the texels show a magnified callout: a single texel exploded to show its 4 channels `(nx, ny, nz, d)` in a small RGBA inspector style

**Strip 2 — uRoomSdfArray (sampler2DArray R16F):**
- Strip header: **"uRoomSdfArray (sampler2DArray R16F)"** with annotation **"64 layers × 128² each layer"**
- Show 3 layered "card stack" graphics (each card is a 128x128 grid suggestion) labeled:
  - Layer 0: lavender shading (#e0d6f0) "Room C · 128³ SDF"
  - Layer 1: ghost "Room D (待 bake)"
  - Layer 2: ghost "..."
- Small callout showing a slice of the 3D SDF as a heatmap (small inset of a grayscale gradient sphere — represents distance field).

Between the two strips, in the middle gap, add a small inline metadata box:
**"uClipPlanesMeta (R32UI)"** with brief content: `(planeStart, planeCount)` pairs

---

### Zone 3 — FRAGMENT SHADER FETCH (bottom, ~25% height)

Label at left: **"3 · FRAGMENT SHADER"**

A single large rounded rectangle with dark ink background (#26251e) and monospace code in cream text (#f7f7f4):

```glsl
bool isInsideAnyRoom(vec3 p) {
  for (i = 0; i < uClipRoomCount; i++) {
    // ① broad-phase AABB
    if (out_of_aabb(p, i)) continue;
    
    // ② narrow-phase
    if (uClipRoomMode[i] == PLANES) {
      // texelFetch uClipPlanesTexture[start..start+count]
      // ∀ plane: dot(p, n) - d ≤ 0
      if (insideHulls(i, p)) return true;
    } else {
      // texture(uRoomSdfArray, vec3(uvw, layer))
      if (insideSdf(i, p)) return true;
    }
  }
  return false;
}
```

Use syntax coloring inside the code box:
- keywords (`bool`, `for`, `if`, `return`) in light orange #ffb877
- type names (`vec3`, `int`) in light cyan
- comments in muted grey #807d72
- function names in light yellow

To the right of this code box, three small annotation badges with arrows pointing to the corresponding line:
- Pointing at line ①: orange badge **"broad-phase 80% 命中率"**
- Pointing at line ② PLANES branch: blue badge **"~30 dot 运算 / fragment"**  
- Pointing at line ② SDF branch: lavender badge **"1 texture sample / fragment"**

---

### Bottom corner badges:

- Bottom-left: **"v1 · 2026-05"** muted grey
- Bottom-right: small green check + **"GLSL3 / WebGL2 / sampler2DArray"** muted grey

---

**Strict color palette:**
- Canvas: #f7f7f4
- Card white: #ffffff
- Hairline: #cfcdc4
- Ink dark: #26251e
- Muted: #807d72
- Cursor orange: #f54e00 (sparingly, only for hero accents)
- Planes blues: #dce6f5, #c5d4e8, #4a6fa5
- SDF lavender: #e0d6f0, #7b5fa3
- Code box bg: #26251e
- Code text cream: #f7f7f4
- Syntax highlight orange: #ffb877
- Syntax highlight cyan: #9fd6e8
- Syntax highlight yellow: #f0d97e
- Success green: #1f8a65

**Composition:**
- All Chinese and English text must be crisp, no garbled characters
- Heavy use of monospace font (JetBrains Mono style) for code and identifiers
- Thin 1px arrows #5a5852
- No drop shadows, no glows
- Aspect ratio: 1:1 (1024x1024)
- This must look like a slide in a Vercel engineering deep-dive blog post or a Stripe Atlas RFC. Dense but readable.
