# DTX 房间凸壳裁剪 — 效果示意图 Prompt

**Task slug**: dtx-room-clip-effect
**Timestamp**: 20260523-105500
**Mode**: B (Host-Native — Cursor `GenerateImage`)
**Target**: PNG 1:1 (技术示意图)

---

## Prompt

A clean, professional 3D technical illustration for an industrial plant 3D viewer, **side-by-side comparison** layout with a thin vertical divider in the middle. Isometric projection, soft studio lighting on a near-white off-white background (#f7f7f4). Engineering blueprint aesthetic — precise lines, low-saturation industrial palette, no photorealistic clutter.

**Left panel (labeled "BEFORE · 朴素隐藏"):**
A 3D scene of an industrial pipe rack passing through a single rectangular building room. Show 4-6 horizontal steel pipes (diameter ~300mm, dark steel blue #4a6fa5) running on a pipe rack from left side, entering and exiting through the room's wall, continuing to the right side. The room is a translucent rectangular volume with light-blue glass walls (#a8c5e8, 30% opacity) and visible thin edge wireframe (#2c3e50, 1px). 
- Show **the entire pipes fully visible** including the parts outside the room boundary — pipes extend well beyond the room on both sides.
- A small callout annotation with leader line pointing to the pipe extending outside the room reads: **"⚠ 旁边构件干扰房间视图"** in a small clean sans-serif font, with a subtle orange warning dot.
- Bottom-left of this panel: a tiny axis gizmo (X red, Y green, Z blue).

**Right panel (labeled "AFTER · 凸壳裁剪"):**
The exact same camera angle, same room, same pipe rack geometry — but with the **clipping effect applied**: 
- Pipe segments are **cleanly cut precisely at the room's boundary walls** by an invisible plane along the wall surface. 
- Inside the room: pipe sections fully rendered in the same dark steel blue.
- Outside the room: pipe segments are completely hidden (gone, not faded — just absent), exposing the void where the pipe was.
- At each cut point (where pipes meet the wall), show a thin bright orange highlight ring (#f54e00, 2px stroke) marking the clip plane intersection — making the "wall slicing pipe" effect obvious and elegant.
- A callout with leader line pointing to one of the highlight rings reads: **"✓ 按房间边界精准切断"** in the same font.
- Small text at panel bottom: **"使用 ConvexHull 多面体 SDF · per-fragment discard"** in a tiny mono-spaced font.

**Top header (spanning both panels):** Bold title **"DTX 房间凸壳裁剪 · Room ConvexHull Clipping"** in clean modern sans-serif (e.g., Inter or PingFang SC), color #26251e. Below it a small subtitle in muted grey: **"plant3d-web · DTXMaterial fragment shader · 方案 C"**.

**Color palette (strict):**
- Background: #f7f7f4 (warm cream canvas)
- Room glass: #a8c5e8 at 30% opacity
- Room edge wireframe: #2c3e50
- Pipes / steel: #4a6fa5 with subtle metallic shading
- Pipe rack frame: #6b6b6b
- Highlight / cut rings: #f54e00 (Cursor orange)
- Annotation text: #26251e (ink)
- Muted text: #807d72
- Callout leader lines: #5a5852 hairline

**Composition rules:**
- Symmetric two-panel layout, 50/50 split.
- Generous whitespace around each panel (≥10% margin).
- Thin 1px divider between panels (#cfcdc4).
- Camera at ~30° azimuth, ~20° elevation, slight bird's-eye view.
- Pipe rack orientation: pipes run along the X-axis, room is a Y-Z aligned box.
- Both panels share the exact same view to make the difference instantly readable.
- No drop shadows, no glow effects, no AI-render artifacts.
- All text MUST be crisp and legible (no garbled glyphs); prefer rendering text as clean vector-like type.

**Style references:** Bell Labs technical sketches × modern web design system documentation × isometric architecture diagrams (Notion / Linear illustration style). Editorial-precise, not flashy. The image must look like it could appear in an engineering RFC document.

**Aspect ratio:** 1:1 (1024x1024).

---

## Usage notes

- Mode B: 直接传给宿主 `GenerateImage` 工具的 `description` 字段。
- 如生成后文字不完整 / 出现错别字，可在 prompt 顶部加 "Render all Chinese text as crisp clean glyphs, no garbled characters" 重试。
