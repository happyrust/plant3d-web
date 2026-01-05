// @ts-nocheck
import {
    Viewer,
    Mesh,
    ReadableGeometry,
    PhongMaterial,
    // @ts-ignore
    buildVectorTextGeometry,
    math
} from '@xeokit/xeokit-sdk';

import { type AnnotationCommand } from '@/api/pipelineAnnotationApi';

/**
 * 管道标注渲染器
 * 负责将 AnnotationCommand 转换为 xeokit 的 3D 实体 (Mesh/LineSet)
 */
export class PipelineAnnotationRenderer {
    private viewer: Viewer;
    private annotationIds: Map<string, string[]> = new Map(); // refno -> entityIds[]

    // Materials
    private textMaterial: PhongMaterial;
    private lineMaterial: PhongMaterial;
    private symbolMaterial: PhongMaterial; // Point/Symbol material

    constructor(viewer: Viewer) {
        this.viewer = viewer;
        this.initMaterials();
    }

    private initMaterials() {
        // 文字材质 (白色，发光)
        this.textMaterial = new PhongMaterial(this.viewer.scene, {
            id: "pipeline_annotation_text_mat",
            emissive: [1, 1, 1],
            diffuse: [0, 0, 0],
            lineWidth: 2
        });

        // 线条材质 (白色)
        this.lineMaterial = new PhongMaterial(this.viewer.scene, {
            id: "pipeline_annotation_line_mat",
            emissive: [1, 1, 1],
            diffuse: [0, 0, 0],
            lineWidth: 1
        });

        // 符号材质
        this.symbolMaterial = new PhongMaterial(this.viewer.scene, {
            id: "pipeline_annotation_symbol_mat",
            emissive: [1, 1, 0], // Yellow
            diffuse: [0, 0, 0],
            lineWidth: 2
        });
    }

    /**
     * 渲染一组标注
     */
    public render(refno: string, commands: AnnotationCommand[]): string[] {
        const entityIds: string[] = [];
        this.clear(refno); // Clear existing for this refno

        console.log(`PipelineAnnotationRenderer: Rendering ${commands.length} annotations for ${refno}`);

        commands.forEach((cmd, index) => {
            try {
                // Generate a unique ID prefix for this command's entities
                const ids = this.renderCommand(cmd, `${refno}_${index}_${Date.now()}`);
                entityIds.push(...ids);
            } catch (e) {
                console.error(`Failed to render annotation command ${index}:`, e);
            }
        });

        this.annotationIds.set(refno, entityIds);
        return entityIds;
    }

    /**
     * 清除指定 refno 的所有标注
     */
    public clear(refno: string) {
        const ids = this.annotationIds.get(refno);
        if (ids) {
            ids.forEach(id => {
                const entity = this.viewer.scene.objects[id];
                if (entity) entity.destroy();
            });
            this.annotationIds.delete(refno);
        }
    }

    /**
     * 清除所有标注
     */
    public clearAll() {
        for (const refno of this.annotationIds.keys()) {
            this.clear(refno);
        }
    }

    private renderCommand(cmd: AnnotationCommand, idPrefix: string): string[] {
        const ids: string[] = [];

        switch (cmd.type) {
            case 'DimensionLine':
                ids.push(...this.renderDimensionLine(cmd, idPrefix));
                break;
            case 'TextLabel':
                ids.push(...this.renderTextLabel(cmd, idPrefix));
                break;
            case 'WeldSymbol':
                ids.push(...this.renderWeldSymbol(cmd, idPrefix));
                break;
            case 'SupportSymbol':
                ids.push(...this.renderSupportSymbol(cmd, idPrefix));
                break;
            case 'SlopeAnnotation':
                ids.push(...this.renderSlopeAnnotation(cmd, idPrefix));
                break;
        }

        return ids;
    }

    // --- Geometry Builders ---

    private createText(text: string, position: number[], size: number, id: string, color?: number[]): string {
        if (!buildVectorTextGeometry) {
            return "";
        }

        // buildVectorTextGeometry returns { positions: Float32Array, indices: Float32Array }
        // The text is erected in X-Y plane by default. center at origin?
        const geometryData = buildVectorTextGeometry({
            text: text,
            size: size
        });

        const geometry = new ReadableGeometry(this.viewer.scene, {
            primitive: "lines",
            positions: geometryData.positions,
            indices: geometryData.indices
        });

        const material = color ?
            new PhongMaterial(this.viewer.scene, { emissive: color, diffuse: [0, 0, 0], lineWidth: 2 }) :
            this.textMaterial;

        const mesh = new Mesh(this.viewer.scene, {
            id: id,
            geometry: geometry,
            material: material,
            position: position,
            billboard: "spherical" // Make text always face camera
        });

        return mesh.id;
    }

    private createLines(points: number[], id: string, loop: boolean = false): string {
        const indices = [];
        for (let i = 0; i < points.length / 3 - 1; i++) {
            indices.push(i, i + 1);
        }
        if (loop && points.length >= 3) {
            indices.push(points.length / 3 - 1, 0);
        }

        const geometry = new ReadableGeometry(this.viewer.scene, {
            primitive: "lines",
            positions: points,
            indices: indices
        });

        const mesh = new Mesh(this.viewer.scene, {
            id: id,
            geometry: geometry,
            material: this.lineMaterial
        });

        return mesh.id;
    }

    // --- Type Specific Rendering ---

    /**
     * 渲染尺寸线
     * 包含：主线段、两端箭头、两侧引出线(Extension Lines)、文字
     */
    private renderDimensionLine(cmd: { start: [number, number, number]; end: [number, number, number]; offset?: number; text: string }, idPrefix: string): string[] {
        const ids: string[] = [];
        const start = math.vec3(cmd.start);
        const end = math.vec3(cmd.end);

        // 1. Calculate main direction
        const dir = math.subVec3(end, start, math.vec3());
        const length = math.lenVec3(dir);
        if (length < 0.1) return ids; // Too short to draw

        math.normalizeVec3(dir);

        // 2. Identify an "up" vector to offset the dimension line
        // We want the dimension line to be slightly offset from the pipe center
        // Heuristic: try UP (0,1,0), if parallel then X (1,0,0)
        let up = math.vec3([0, 1, 0]);
        if (Math.abs(math.dotVec3(dir, up)) > 0.9) {
            up = math.vec3([1, 0, 0]);
        }

        // Orthogonal vector for offset extension
        const offsetDir = math.cross3Vec3(dir, up, math.vec3());
        math.normalizeVec3(offsetDir);

        const offsetDist = cmd.offset || 200; // Default offset 200mm
        const offsetVec = math.mulVec3Scalar(offsetDir, offsetDist, math.vec3());

        const dimStart = math.addVec3(start, offsetVec, math.vec3());
        const dimEnd = math.addVec3(end, offsetVec, math.vec3());

        // 3. Draw Extension Lines (from point to dim line)
        // Start extension
        ids.push(this.createLines([...start, ...dimStart], `${idPrefix}_ext_1`));
        // End extension
        ids.push(this.createLines([...end, ...dimEnd], `${idPrefix}_ext_2`));

        // 4. Draw Main Dimension Line (with gap for text?)
        // For simplicity, draw full line for now, text will float above
        ids.push(this.createLines([...dimStart, ...dimEnd], `${idPrefix}_dim_line`));

        // 5. Draw Arrows at dimStart and dimEnd
        const arrowLen = 50;
        const arrowWidth = 15;
        // Arrow at Start (pointing towards start from inside) or pointing outwards?
        // Standard piping iso: arrows point outwards from the measure line limits, or inwards.
        // Let's draw arrows at the ends of the line segment pointing OUTWARDS (away from center)
        // Vector from dimStart towards dimEnd
        const lineDir = math.subVec3(dimEnd, dimStart, math.vec3());
        math.normalizeVec3(lineDir);

        // Arrow 1 at dimStart, pointing towards dimStart
        // Actually, let's draw them pointing "out" from the center of the gap, 
        // effectively pointing towards the extension lines.
        // Arrow head at dimStart, tail inwards
        ids.push(...this.createArrow(dimStart, lineDir, arrowLen, arrowWidth, `${idPrefix}_arrow_1`));

        // Arrow 2 at dimEnd, pointing towards dimEnd (dir is negated)
        const revDir = math.mulVec3Scalar(lineDir, -1, math.vec3());
        ids.push(...this.createArrow(dimEnd, revDir, arrowLen, arrowWidth, `${idPrefix}_arrow_2`));

        // 6. Draw Text at Midpoint
        const mid = math.mulVec3Scalar(math.addVec3(dimStart, dimEnd, math.vec3()), 0.5, math.vec3());
        // Text offset slightly "above" the line (along offsetDir or up?)
        const textOffset = math.mulVec3Scalar(offsetDir, 20, math.vec3());
        const textPos = math.addVec3(mid, textOffset, math.vec3());

        ids.push(this.createText(cmd.text, textPos, 80, `${idPrefix}_text`));

        return ids;
    }

    /**
     * Helper to create an arrow head
     * tip: Arrow tip position
     * dir: Direction vector pointing AWAY from the tip (towards the tail)
     */
    private createArrow(tip: Float64Array, dir: Float64Array, length: number, width: number, id: string): string[] {
        // Base of arrow
        const tail = math.addVec3(tip, math.mulVec3Scalar(dir, length, math.vec3()), math.vec3());

        // We need 'side' vectors. 
        // Since it's 3D, we can create a cross shape or a cone wireframe.
        // Let's create a simple "V" shape or triangle in a plane.

        // Find arbitrary perp vector
        let up = math.vec3([0, 1, 0]);
        if (Math.abs(math.dotVec3(dir, up)) > 0.9) {
            up = math.vec3([1, 0, 0]);
        }
        const right = math.cross3Vec3(dir, up, math.vec3());
        math.normalizeVec3(right);
        const upOrtho = math.cross3Vec3(right, dir, math.vec3()); // True up orthogonal to dir

        // V-shape lines
        const side1 = math.addVec3(tail, math.mulVec3Scalar(right, width, math.vec3()), math.vec3());
        const side2 = math.addVec3(tail, math.mulVec3Scalar(right, -width, math.vec3()), math.vec3());
        const side3 = math.addVec3(tail, math.mulVec3Scalar(upOrtho, width, math.vec3()), math.vec3());
        const side4 = math.addVec3(tail, math.mulVec3Scalar(upOrtho, -width, math.vec3()), math.vec3());

        // Draw 4 lines from tip to sides
        const points = [
            ...tip, ...side1,
            ...tip, ...side2,
            ...tip, ...side3,
            ...tip, ...side4
        ];

        return [this.createLines(points, id)];
    }

    private renderTextLabel(cmd: { position: [number, number, number]; text: string; leader_end?: [number, number, number] }, idPrefix: string): string[] {
        const ids = [];
        const pos = cmd.position;

        if (cmd.leader_end) {
            // Draw leader line
            ids.push(this.createLines([...pos, ...cmd.leader_end], `${idPrefix}_leader`));
        }

        ids.push(this.createText(cmd.text, pos, 80, `${idPrefix}_text`));
        return ids;
    }

    private renderWeldSymbol(cmd: { position: [number, number, number]; weld_type: number }, idPrefix: string): string[] {
        const ids = [];
        const center = math.vec3(cmd.position);

        // Draw a circle (approx by 12 segments)
        // We need it to face camera? or lie flat? Let's make it billboard-ish or XY plane.
        // Simple distinct shape: Circle with Cross
        const radius = 30;
        const segments = 12;
        const circlePoints = [];
        // Local circle on XY plane
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            circlePoints.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
        }

        // We need a Mesh for billboard, but we want lines. 

        const indices = [];
        for (let i = 0; i < segments; i++) {
            indices.push(i, i + 1);
        }

        const geometry = new ReadableGeometry(this.viewer.scene, {
            primitive: "lines",
            positions: circlePoints,
            indices: indices
        });

        const mesh = new Mesh(this.viewer.scene, {
            id: `${idPrefix}_circle`,
            geometry: geometry,
            material: this.symbolMaterial,
            position: cmd.position,
            billboard: "spherical"
        });
        ids.push(mesh.id);

        // Add text "W" inside
        ids.push(this.createText("W", cmd.position, 40, `${idPrefix}_w`, [1, 1, 0]));

        return ids;
    }

    private renderSupportSymbol(cmd: { position: [number, number, number]; support_type: string }, idPrefix: string): string[] {
        // Draw a triangle for support
        const ids = [];
        const width = 40;
        const height = 60;

        // Triangle pointing up
        // Since we use billboard, define in local XY
        const p1 = [0, height / 2, 0];
        const p2 = [-width / 2, -height / 2, 0];
        const p3 = [width / 2, -height / 2, 0];

        const points = [...p1, ...p2, ...p2, ...p3, ...p3, ...p1]; // Wireframe triangle

        const geometry = new ReadableGeometry(this.viewer.scene, {
            primitive: "lines",
            positions: points,
            indices: [0, 1, 2, 3, 4, 5]
        });

        const mesh = new Mesh(this.viewer.scene, {
            id: `${idPrefix}_tri`,
            geometry: geometry,
            material: this.symbolMaterial,
            position: cmd.position,
            billboard: "spherical"
        });
        ids.push(mesh.id);

        // Text
        ids.push(this.createText(cmd.support_type.substring(0, 3), cmd.position, 40, `${idPrefix}_text`, [1, 1, 0]));

        return ids;
    }

    private renderSlopeAnnotation(cmd: { start: [number, number, number]; end: [number, number, number]; slope_value: number }, idPrefix: string): string[] {
        const ids = [];
        // 1. Line indicating flow/slope (offset similar to dimension)
        const start = math.vec3(cmd.start);
        const end = math.vec3(cmd.end);

        // Offset logic (same as dim line)
        const dir = math.subVec3(end, start, math.vec3());
        math.normalizeVec3(dir);
        let up = math.vec3([0, 1, 0]);
        if (Math.abs(math.dotVec3(dir, up)) > 0.9) up = math.vec3([1, 0, 0]);
        const offsetDir = math.cross3Vec3(dir, up, math.vec3());
        math.normalizeVec3(offsetDir);
        const offsetVec = math.mulVec3Scalar(offsetDir, 150, math.vec3()); // Smaller offset than dim line

        const sStart = math.addVec3(start, offsetVec, math.vec3());
        const sEnd = math.addVec3(end, offsetVec, math.vec3());

        // Draw Slope Line
        ids.push(this.createLines([...sStart, ...sEnd], `${idPrefix}_slope_line`));

        // Draw Slope Triangle at midpoint
        const mid = math.mulVec3Scalar(math.addVec3(sStart, sEnd, math.vec3()), 0.5, math.vec3());

        // Triangle geometry
        const text = (cmd.slope_value * 100).toFixed(1) + "%";
        ids.push(this.createText(text, mid, 60, `${idPrefix}_text`));

        // Add a small arrow on the line to indicate direction
        const arrowLen = 40;
        const axisDir = math.subVec3(sEnd, sStart, math.vec3());
        math.normalizeVec3(axisDir);

        // Arrow head at 2/3 distance
        const arrowPos = math.addVec3(sStart, math.mulVec3Scalar(math.subVec3(sEnd, sStart, math.vec3()), 0.7, math.vec3()), math.vec3());
        // Pointing down-slope? Ideally backend ensures start->end reflects slope direction.
        ids.push(...this.createArrow(arrowPos, math.mulVec3Scalar(axisDir, -1, math.vec3()), arrowLen, 10, `${idPrefix}_arrow`));

        return ids;
    }
}
