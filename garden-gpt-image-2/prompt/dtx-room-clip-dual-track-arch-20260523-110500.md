# DTX 房间裁剪双轨架构图 — Prompt

**Task slug**: dtx-room-clip-dual-track-arch
**Timestamp**: 20260523-110500
**Mode**: B (Host-Native, Cursor `GenerateImage`)
**Target**: PNG 1:1 architectural diagram

---

## Prompt

A clean, editorial-style technical architecture diagram on a warm cream background (#f7f7f4). NOT a 3D illustration — this is a 2D system architecture flowchart in the style of Linear's documentation, Notion engineering docs, or a Stripe API diagram. Crisp vector-style boxes connected by thin arrows.

**Top header (centered):**
- Bold title in clean sans-serif (Inter/PingFang SC), color #26251e:
  **"DTX 房间裁剪 · 双轨架构"**
- Subtitle in muted grey #807d72, smaller:
  **"Dual-Track Room Clipping Architecture · plant3d-web"**

**Layout: top-to-bottom flow, 5 horizontal bands.**

**Band 1 — Input (top):**
Two side-by-side rounded rectangles labeled:
- **"Room TriMesh"** with a tiny mesh icon (triangular wireframe glyph)
- **"ConvexRuntime (凸分解)"** with a tiny cube icon
Both have a thin hairline border (#cfcdc4), white interior (#ffffff), 8px rounded corners.

**Band 2 — Classifier (orange decision diamond, centered):**
A rounded rectangle (NOT a diamond, use rounded rect to feel modern) in **bright Cursor orange #f54e00** background with white text:
- **"classify_room()"** (mono font)
- Subtitle in smaller white text: **"AABB 填充率 · 法向多样性 · plane 总数"**

Three thin curved arrows fan downward from this box to three mode boxes below, each labeled with the decision criteria on the arrow:
- Left arrow label: **"fill_ratio > 0.95"**
- Middle arrow label: **"normal_div < 0.05 && planes ≤ 256"**
- Right arrow label: **"曲面 / hulls > 16"**

**Band 3 — Three mode boxes (side by side):**
Three rounded rectangles, equal width, with distinct color schemes:

LEFT box — **AABB mode**:
- Background: light blue #dce6f5
- Border: #4a6fa5 thin
- Title bold: **"mode = AABB"**
- Body: "6 plane · 立方体房间 · 最便宜"
- Tiny icon: a wireframe cube

MIDDLE box — **CONVEX_HULLS mode**:
- Background: slightly darker blue #c5d4e8
- Border: #4a6fa5 thin
- Title bold: **"mode = CONVEX_HULLS"**
- Body: "N plane 集合 · 多面体房间 · 通用路径"
- Tiny icon: a faceted polyhedron wireframe

RIGHT box — **SDF mode**:
- Background: light lavender/purple #e0d6f0
- Border: #7b5fa3 thin
- Title bold: **"mode = SDF"**
- Body: "128³ 距离场 · 弧面/复杂凹形 · 形状无关"
- Tiny icon: a sphere or curved surface glyph

**Band 4 — Backend artifacts (parallel to band 3, just below):**
Three rounded rectangles, white background, hairline border, smaller text:

Below AABB: **"inst_relate.aabb (复用)"** in mono font
Below CONVEX_HULLS: **"convex_decomp.rkyv (复用)"** in mono font
Below SDF: **"sdf/<hash>.rkyv (新增 bake)"** in mono font with a small orange dot marker

**Band 5 — Unified API (centered, spanning full width):**
A long horizontal pill-shaped box with cream-to-white gradient, hairline border:
- **"GET /api/room/clip-config?ids=..."** in mono font, larger
- Below: **`{ mode, room_refno, ... }`** in tiny mono with light syntax coloring

Three thin arrows converge from band 4 into this band.

**Band 6 — Frontend (below the API band):**
Two side-by-side rounded rectangles:

LEFT box: **"DTXClipController.setRooms()"**
- Bullet items inside (small font):
  - "拆桶 planes / sdf"
  - "uploadPlanesData() → RGBA32F texture"
  - "uploadSdfTextures() → sampler2DArray"

RIGHT box: **"DTXMaterial fragment shader"**
- Pseudo-code style inside (mono font):
  ```
  isInsideAnyRoom(p) {
    AABB broad-phase
    if mode==PLANES: insideHulls(p)
    else: insideSdf(p)
  }
  ```

An arrow flows from API → DTXClipController → DTXMaterial.

**Bottom corner badges (small, low-contrast):**
- Bottom-left: tiny version tag **"v1 · 2026-05"** in muted grey
- Bottom-right: tiny **"DTX shader 单 draw call 保持不变"** in muted grey with a small green check icon

**Strict color palette (USE ONLY THESE):**
- Canvas: #f7f7f4
- Card white: #ffffff
- Hairline: #cfcdc4
- Ink text: #26251e
- Muted text: #807d72
- Cursor orange (decision/highlight): #f54e00
- Planes track blues: #dce6f5, #c5d4e8, #4a6fa5
- SDF track lavender: #e0d6f0, #7b5fa3
- Success green tiny check: #1f8a65

**Composition rules:**
- All text MUST be crisp, legible, no garbled glyphs. Chinese characters must render cleanly.
- Generous whitespace between bands (use 24px-equivalent gaps).
- Thin 1px arrows (#5a5852), small arrowheads.
- No drop shadows. No glow. No gradient noise. No photoreal textures.
- Style references: Linear.app docs, Stripe API diagrams, Notion engineering blog illustrations, Vercel architecture diagrams.
- Aspect ratio: 1:1 (1024x1024).

The diagram must look like it could appear in an internal RFC or design doc — editorial, professional, instantly scannable, NOT marketing material.
