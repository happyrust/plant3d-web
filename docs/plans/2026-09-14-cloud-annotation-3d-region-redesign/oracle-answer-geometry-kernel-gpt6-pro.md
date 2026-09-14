# GPT-6 Pro 参考几何内核（plant3d-cloud-geometry-core 会话追问回收，2026-09-14）

> 上一轮回答末尾附带的沙盒文件 `cloud_annotation_geometry.ts` 与 `cloud_geometry_selfcheck.json` 无法下载，追问（会话 `plant3d-cloud-geometry-kernel-dump`）让其原样贴出。
> **性质**：参考实现，不是本项目补丁；GPT 自述通过 TypeScript 严格类型检查与 21 项隔离数值自检，**未跑本仓 Vue / DTX / Vitest**。落地时按 §3.3 的目录拆成子模块并补本仓测试。

```ts
/**
 * Proposed pure cloud-annotation geometry kernel. No DOM, Vue or three.js imports.
 * Matrices are column-major (three.js Matrix4.elements convention).
 * Screen coordinates are CSS pixels, x right / y down. Positive signed-area
 * polygons therefore look clockwise on screen. WebGL NDC z is [-1, 1].
 * This is a reference implementation, not a patch to the supplied application.
 */
export type V3 = readonly [number, number, number];
export type V4 = readonly [number, number, number, number];
export type Mat4 = readonly number[];
export type P2 = { x: number; y: number; id: string };
export type WorldVertex = { p: V3; id: string };
export type WorldCell = readonly (readonly WorldVertex[])[];
export type ClipVertex = { h: V4; p: V3; id: string };
export type ClipSolid = ClipVertex[][];
export type Plane4 = { id: string; n: V4; k: number };
export type Viewport = { width: number; height: number };
export type Rect = { left: number; top: number; right: number; bottom: number };
const TAU = Math.PI * 2;
const mod = (x: number, n: number) => ((x % n) + n) % n;
const dot3 = (a: V3, b: V3) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub3 = (a: V3, b: V3): V3 => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const cross3 = (a: V3, b: V3): V3 => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len3 = (a: V3) => Math.hypot(...a);
const unit3 = (a: V3): V3 => { const n=len3(a); if (!(n>0)) throw Error('zero vector'); return [a[0]/n,a[1]/n,a[2]/n]; };
export const cross2 = (a: P2,b: P2,c: P2) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
export const signedArea = (p: readonly P2[]) => p.reduce((s,a,i)=>{ const b=p[(i+1)%p.length]; return s+a.x*b.y-a.y*b.x; },0)/2;
function validViewport(v: Viewport): void { if (!(v.width>0&&v.height>0&&Number.isFinite(v.width+v.height))) throw Error('invalid viewport'); }
export function mul4(m: Mat4, p: V4): V4 {
  if(m.length!==16) throw Error('Matrix4 needs 16 values');
  const out = [0,0,0,0];
  for(let r=0;r<4;r++) for(let c=0;c<4;c++) out[r]+=m[c*4+r]*p[c];
  if(!out.every(Number.isFinite)) throw Error('non-finite transform');
  return out as unknown as V4;
}
export function transformPoint(m: Mat4,p: V3): V3 {
  const h=mul4(m,[...p,1]); if(Math.abs(h[3])<1e-15) throw Error('point at infinity');
  return [h[0]/h[3],h[1]/h[3],h[2]/h[3]];
}
/** localToWorld MUST already include globalModelMatrix exactly once. */
export function buildObjectBoxCell(min: V3,max: V3,localToWorld: Mat4,objectId: string): WorldVertex[][] {
  if([...min,...max].some(x=>!Number.isFinite(x))||min.some((x,i)=>x>max[i])) throw Error('invalid local box');
  const bits=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  const vertices=bits.map((b,i)=>({ id:`src:${objectId}:${i}`,p:transformPoint(localToWorld,b.map((v,j)=>v?max[j]:min[j]) as unknown as V3) }));
  return [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]].map(f=>f.map(i=>vertices[i]));
}
/** No silent filtering of NaNs: missing support vertices destroy enclosure. */
export function convexHull2d(points: readonly P2[]): P2[] {
  if(points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))) throw Error('invalid hull input');
  const p=[...points].sort((a,b)=>a.x-b.x||a.y-b.y||a.id.localeCompare(b.id))
    .filter((p,i,a)=>i===0||p.x!==a[i-1].x||p.y!==a[i-1].y);
  if(p.length<3) return p;
  const half=(items: P2[])=>{ const h:P2[]=[]; for(const q of items){ while(h.length>=2&&cross2(h[h.length-2],h[h.length-1],q)<=0) h.pop(); h.push(q); } return h; };
  return [...half(p).slice(0,-1),...half([...p].reverse()).slice(0,-1)];
}
const eval4 = (p: Plane4,v: ClipVertex) => p.n.reduce((s,n,i)=>s+n*v.h[i],p.k);
function mixVertex(a: ClipVertex,b: ClipVertex,t: number,plane: string): ClipVertex {
  if(t<=0) return a; if(t>=1) return b;
  const mix=(x: readonly number[],y: readonly number[])=>x.map((v,i)=>v+(y[i]-v)*t);
  return {h:mix(a.h,b.h) as unknown as V4,p:mix(a.p,b.p) as unknown as V3,id:`cut:${plane}(${[a.id,b.id].sort().join('|')})`};
}
export function clipFace4(face: readonly ClipVertex[],plane: Plane4): ClipVertex[] {
  const out:ClipVertex[]=[];
  for(let i=0;i<face.length;i++){
    const a=face[i],b=face[(i+1)%face.length],da=eval4(plane,a),db=eval4(plane,b);
    if((da>=0)!==(db>=0)) out.push(mixVertex(a,b,da/(da-db),plane.id));
    if(db>=0) out.push(b);
  }
  return out;
}
/** Order a NEW CAP in its original world-space plane; never sort x/w yet. */
function orderCap(vertices: readonly ClipVertex[],worldEps: number): ClipVertex[] {
  const unique:ClipVertex[]=[];
  for(const v of [...vertices].sort((a,b)=>a.id.localeCompare(b.id)))
    if(!unique.some(u=>len3(sub3(u.p,v.p))<=worldEps)) unique.push(v);
  if(unique.length<3) return [];
  const origin=unique[0].p;
  const furthest=unique.reduce((a,b)=>len3(sub3(a.p,origin))>=len3(sub3(b.p,origin))?a:b);
  const u=unit3(sub3(furthest.p,origin));
  const normal=unique.map(v=>cross3(u,sub3(v.p,origin))).reduce((a,b)=>len3(a)>=len3(b)?a:b);
  if(len3(normal)<=worldEps) return [];
  const v=cross3(unit3(normal),u);
  const byId=new Map(unique.map(p=>[p.id,p]));
  return convexHull2d(unique.map(p=>({id:p.id,x:dot3(sub3(p.p,origin),u),y:dot3(sub3(p.p,origin),v)}))).map(p=>byId.get(p.id)!);
}
/** Closed convex-solid clipping. New caps participate in EVERY following plane. */
export function clipConvexSolid4(solid: ClipSolid,planes: readonly Plane4[],worldEps=1e-8): ClipSolid {
  let faces=solid.map(f=>[...f]);
  for(const plane of planes){
    const cuts:ClipVertex[]=[]; const next:ClipSolid=[];
    let sawInside=false,sawOutside=false;
    for(const f of faces){
      for(let i=0;i<f.length;i++){
        const a=f[i],b=f[(i+1)%f.length],da=eval4(plane,a),db=eval4(plane,b);
        if(da>=0) sawInside=true; else sawOutside=true;
        if((da>=0)!==(db>=0)) cuts.push(mixVertex(a,b,da/(da-db),plane.id));
      }
      const clipped=clipFace4(f,plane); if(clipped.length>=3) next.push(clipped);
    }
    if(sawInside&&sawOutside){ const cap=orderCap(cuts,worldEps); if(cap.length>=3) next.push(cap); }
    faces=next; if(!faces.length) break;
  }
  return faces;
}
export const depthPlanes = (wEps: number): Plane4[] => [
  {id:'positive-w',n:[0,0,0,1],k:-wEps},
  {id:'near',n:[0,0,1,1],k:0},
  {id:'far',n:[0,0,-1,1],k:0},
];
export const lateralPlanes: Plane4[] = [
  {id:'left',n:[1,0,0,1],k:0},{id:'right',n:[-1,0,0,1],k:0},
  {id:'bottom',n:[0,1,0,1],k:0},{id:'top',n:[0,-1,0,1],k:0},
];
export function toClipSolid(cell: WorldCell,viewProjection: Mat4): ClipSolid {
  return cell.map(f=>f.map(v=>({...v,h:mul4(viewProjection,[...v.p,1])})));
}
function clipPolygon2d(p: readonly P2[],distance:(p:P2)=>number,id:string): P2[] {
  const out:P2[]=[];
  for(let i=0;i<p.length;i++){
    const a=p[i],b=p[(i+1)%p.length],da=distance(a),db=distance(b);
    if((da>=0)!==(db>=0)){ const t=da/(da-db); out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,id:`${id}(${[a.id,b.id].sort().join('|')})`}); }
    if(db>=0) out.push(b);
  }
  return out;
}
/** For positive-area polygons; point/segment degeneracy is retained as well. */
export function intersectHullWithRect(hull: readonly P2[],r: Rect): P2[] {
  let p=[...hull];
  for(const [id,f] of [['left',(q:P2)=>q.x-r.left],['right',(q:P2)=>r.right-q.x],['top',(q:P2)=>q.y-r.top],['bottom',(q:P2)=>r.bottom-q.y]] as const)
    p=clipPolygon2d(p,f,id);
  return convexHull2d(p);
}
export type Projection = { rawHull:P2[]; visibleHull:P2[]; depthClipped:boolean; viewportCut:boolean; state:'visible'|'offscreen'|'depth-empty' };
/** Clip DEPTH per cell, hull across the union, THEN intersect the viewport. */
export function projectCloudRegion(cells: readonly WorldCell[],viewProjection: Mat4,viewport: Viewport,wEps=1e-8,worldEps=1e-8): Projection {
  validViewport(viewport); if(!(wEps>0&&worldEps>0)) throw Error('invalid epsilon');
  const points:P2[]=[]; let depthClipped=false; const planes=depthPlanes(wEps);
  for(const cell of cells){
    const solid=toClipSolid(cell,viewProjection);
    if(solid.some(f=>f.some(v=>planes.some(p=>eval4(p,v)<0)))) depthClipped=true;
    const clipped=clipConvexSolid4(solid,planes,worldEps);
    for(const v of clipped.flat()){
      if(!(v.h[3]>0)) throw Error('clipper left nonpositive w');
      const x=v.h[0]/v.h[3],y=v.h[1]/v.h[3];
      points.push({id:v.id,x:(x+1)*viewport.width/2,y:(1-y)*viewport.height/2});
    }
  }
  const rawHull=convexHull2d(points),r={left:0,top:0,right:viewport.width,bottom:viewport.height};
  const visibleHull=intersectHullWithRect(rawHull,r);
  return {rawHull,visibleHull,depthClipped,viewportCut:rawHull.some(p=>p.x<0||p.y<0||p.x>r.right||p.y>r.bottom),state:!rawHull.length?'depth-empty':!visibleHull.length?'offscreen':'visible'};
}
export function containsPointInConvexCell(cell: WorldCell,p: V3,eps=1e-8): boolean {
  const verts=cell.flat(); if(!verts.length) return false;
  const center=verts.reduce((s,v)=>[s[0]+v.p[0]/verts.length,s[1]+v.p[1]/verts.length,s[2]+v.p[2]/verts.length] as V3,[0,0,0] as V3);
  let planes=0;
  for(const f of cell){
    if(f.length<3) continue;
    const n=cross3(sub3(f[1].p,f[0].p),sub3(f[2].p,f[0].p)),len=len3(n);
    if(len<=eps) continue;
    const dc=dot3(n,sub3(center,f[0].p)); if(Math.abs(dc)<=eps*len) continue;
    planes++;
    if(dot3(n,sub3(p,f[0].p))*Math.sign(dc)<-eps*len) return false;
  }
  return planes>=4;
}
export type PathSegment =
  | {kind:'line';s0:number;length:number;from:P2;to:P2;nx:number;ny:number}
  | {kind:'arc';s0:number;length:number;center:P2;radius:number;startAngle:number;sweep:number};
export type RoundedPath = {segments:PathSegment[];length:number;features:Record<string,number>};
/** Exact Minkowski boundary hull (+) disk(radius); arc midpoints retain corner IDs. */
export function buildRoundedConvexPath(input: readonly P2[],radius: number): RoundedPath {
  if(!(radius>0)) throw Error('positive padding required');
  const hull=convexHull2d(input); if(hull.length<3||signedArea(hull)<=0) throw Error('use point/segment LOD before rounded hull');
  const n=hull.map((a,i)=>{const b=hull[(i+1)%hull.length],l=Math.hypot(b.x-a.x,b.y-a.y); return {x:(b.y-a.y)/l,y:-(b.x-a.x)/l};});
  const segments:PathSegment[]=[],features:Record<string,number>={}; let s=0;
  for(let i=0;i<hull.length;i++){
    const a=hull[i],b=hull[(i+1)%hull.length],before=n[(i+n.length-1)%n.length],after=n[i];
    const sweep=mod(Math.atan2(before.x*after.y-before.y*after.x,before.x*after.x+before.y*after.y),TAU);
    if(sweep>Math.PI+1e-8) throw Error('non-convex normal turn');
    const arcLength=radius*sweep;
    features[a.id]=s+arcLength/2;
    if(arcLength>0) segments.push({kind:'arc',s0:s,length:arcLength,center:a,radius,startAngle:Math.atan2(before.y,before.x),sweep});
    s+=arcLength;
    const from={...a,x:a.x+radius*after.x,y:a.y+radius*after.y},to={...b,x:b.x+radius*after.x,y:b.y+radius*after.y};
    const length=Math.hypot(to.x-from.x,to.y-from.y);
    segments.push({kind:'line',s0:s,length,from,to,nx:after.x,ny:after.y}); s+=length;
  }
  return {segments,length:s,features};
}
export function atArcLength(path: RoundedPath,s: number): {x:number;y:number;nx:number;ny:number} {
  s=mod(s,path.length);
  const seg=path.segments.find(x=>s<x.s0+x.length)??path.segments[path.segments.length-1];
  const t=Math.max(0,Math.min(1,(s-seg.s0)/seg.length));
  if(seg.kind==='line') return {x:seg.from.x+(seg.to.x-seg.from.x)*t,y:seg.from.y+(seg.to.y-seg.from.y)*t,nx:seg.nx,ny:seg.ny};
  const angle=seg.startAngle+t*seg.sweep,nx=Math.cos(angle),ny=Math.sin(angle);
  return {x:seg.center.x+seg.radius*nx,y:seg.center.y+seg.radius*ny,nx,ny};
}
export type PhaseFrame = {anchorId:string;anchorS:number;phaseAtAnchor:number;wavelengthPx:number};
const smoothstep = (x: number) => { const t=Math.max(0,Math.min(1,x)); return t*t*(3-2*t); };
/** Nonnegative raised-cosine scallops. Local seam taper removes loop-count jumps. */
export function cloudHeightAt(s:number,length:number,frame:PhaseFrame,amplitudePx:number): number {
  if(!(length>0&&frame.wavelengthPx>0&&amplitudePx>=0)) throw Error('invalid cloud metric');
  const u=mod(s-frame.anchorS,length),distanceToSeam=Math.min(u,length-u);
  const seamWidth=Math.min(frame.wavelengthPx,length/4);
  const gate=smoothstep(distanceToSeam/seamWidth);
  return amplitudePx*gate*(1-Math.cos(TAU*u/frame.wavelengthPx+frame.phaseAtAnchor))/2;
}
/** Keep stable source ID. On handover, transport the phase at a shared feature.
 * When no IDs survive, the caller supplies a PURE boundary-correspondence result.
 * Handover rendering should blend nonnegative height fields ON THE CURRENT path,
 * not interpolate old/new contour positions (which can lose enclosure).
 */
export function transportCloudPhase(path:RoundedPath,wavelengthPx:number,previous?:{path:RoundedPath;frame:PhaseFrame},fallback?:{oldS:number;newS:number;id:string}):{frame:PhaseFrame;handover:boolean} {
  if(!(wavelengthPx>0)) throw Error('positive wavelength required');
  const ids=Object.keys(path.features).sort((a,b)=>Number(!a.startsWith('src:'))-Number(!b.startsWith('src:'))||a.localeCompare(b));
  if(!previous){ const id=ids[0]; return {frame:{anchorId:id,anchorS:path.features[id],phaseAtAnchor:0,wavelengthPx},handover:false}; }
  const old=previous.frame;
  if(path.features[old.anchorId]!==undefined) return {frame:{...old,anchorS:path.features[old.anchorId],wavelengthPx},handover:false};
  const shared=ids.filter(id=>previous.path.features[id]!==undefined).sort((a,b)=>{
    const distance=(id:string)=>{const d=mod(previous.path.features[id]-old.anchorS,previous.path.length);return Math.min(d,previous.path.length-d);};
    return distance(a)-distance(b)||a.localeCompare(b);
  });
  const id=shared[0]??fallback?.id;
  if(id===undefined) throw Error('phase handover needs boundary correspondence');
  const oldS=shared.length?previous.path.features[id]:fallback!.oldS,newS=shared.length?path.features[id]:fallback!.newS;
  const phaseAtAnchor=mod(old.phaseAtAnchor+TAU*mod(oldS-old.anchorS,previous.path.length)/old.wavelengthPx,TAU);
  return {frame:{anchorId:id,anchorS:newS,phaseAtAnchor,wavelengthPx},handover:true};
}
/** Sampling density never defines the phase. Exact line/arc joints are inserted. */
export function buildCloudScreenPolyline(path:RoundedPath,frame:PhaseFrame,amplitudePx=4,stepPx=2):P2[] {
  if(!(stepPx>0&&Number.isFinite(stepPx))) throw Error('invalid step');
  const samples:number[]=[0,path.length,frame.anchorS,...path.segments.flatMap(s=>[s.s0,s.s0+s.length])];
  // Intended for bounded contours. Huge/offscreen paths must first select visible
  // parameter intervals and sample only those, retaining the SAME global s.
  if(path.length/stepPx>200000) throw Error('select visible path intervals before sampling');
  for(let s=0;s<path.length;s+=stepPx) samples.push(s);
  return [...new Set(samples)].sort((a,b)=>a-b).map((s,i)=>{
    const p=atArcLength(path,s),height=cloudHeightAt(s,path.length,frame,amplitudePx);
    return {id:`sample:${i}`,x:p.x+p.nx*height,y:p.y+p.ny*height};
  });
}
export function chooseSmallTargetLod(width:number,height:number,previous:'cloud'|'icon',active:boolean):'cloud'|'icon'|'minimum-halo' {
  const extent=Math.max(width,height); const small=previous==='icon'?extent<18:extent<12;
  return small?(active?'minimum-halo':'icon'):'cloud';
}
export function chooseOutlineFamily(hullArea:number,rectangleArea:number,hullVertexCount:number,previous:'hull'|'rect',preferDrawingRect:boolean,allowReselect:boolean):'hull'|'rect' {
  if(!preferDrawingRect) return 'hull'; if(!allowReselect||!(hullArea>0)) return previous;
  const ratio=rectangleArea/hullArea;
  if(previous==='rect') return ratio>1.25||hullVertexCount>12?'hull':'rect';
  return ratio<=1.12&&hullVertexCount<=8?'rect':'hull';
}
export function worldPerPixelFromProjection(kind:'perspective'|'orthographic',projection:Mat4,viewport:Viewport,viewDepth:number):{x:number;y:number} {
  validViewport(viewport); const d=kind==='perspective'?viewDepth:1;
  if(!(d>0&&Math.abs(projection[0])>0&&Math.abs(projection[5])>0)) throw Error('invalid projection/depth');
  return {x:2*d/(Math.abs(projection[0])*viewport.width),y:2*d/(Math.abs(projection[5])*viewport.height)};
}
/** Preferred overlay lift: a safe, fixed clip-depth plane. */
export function liftScreenPolylineToBillboard(points:readonly P2[],inverseViewProjection:Mat4,viewport:Viewport,ndcZ=0):number[] {
  validViewport(viewport); if(!(ndcZ>-1&&ndcZ<1)) throw Error('overlay depth must be strictly inside clip interval');
  return points.flatMap(p=>{
    const q=mul4(inverseViewProjection,[2*p.x/viewport.width-1,1-2*p.y/viewport.height,ndcZ,1]);
    if(Math.abs(q[3])<1e-15) throw Error('invalid unprojection');
    return [q[0]/q[3],q[1]/q[3],q[2]/q[3]];
  });
}
export type Ray = {origin:V3;direction:V3};
export function pointOnViewDepth(ray:Ray,cameraPosition:V3,forward:V3,depth:number):V3 {
  const denominator=dot3(ray.direction,forward);
  if(!(denominator>1e-10)) throw Error('ray does not enter forward depth slab');
  const t=(depth-dot3(sub3(ray.origin,cameraPosition),forward))/denominator;
  if(t<-1e-9) throw Error('depth is behind ray origin');
  return [ray.origin[0]+t*ray.direction[0],ray.origin[1]+t*ray.direction[1],ray.origin[2]+t*ray.direction[2]];
}
/** Caller supplies a validated, simple polygon's triangulation (no holes).
 * The triangles MUST cover exactly that polygon; use a deterministic pure
 * ear-clipping implementation, not fan triangulation for a concave lasso.
 */
export function buildLassoDepthCells(rays:readonly Ray[],triangles:readonly (readonly [number,number,number])[],cameraPosition:V3,forwardInput:V3,d0:number,d1:number):WorldVertex[][][] {
  if(!(d0>0&&d1>d0&&Number.isFinite(d1))) throw Error('finite positive depth interval required');
  const forward=unit3(forwardInput);
  const near=rays.map((r,i)=>({id:`lasso:n:${i}`,p:pointOnViewDepth(r,cameraPosition,forward,d0)}));
  const far=rays.map((r,i)=>({id:`lasso:f:${i}`,p:pointOnViewDepth(r,cameraPosition,forward,d1)}));
  return triangles.map(t=>{
    if(t.some(i=>!Number.isInteger(i)||i<0||i>=rays.length)) throw Error('invalid triangle index');
    const p=[...t.map(i=>near[i]),...t.map(i=>far[i])];
    return [[0,2,1],[3,4,5],[0,1,4,3],[1,2,5,4],[2,0,3,5]].map(f=>f.map(i=>p[i]));
  });
}
export function selectCloudPresentation(mode:'screen2d'|'bbox3d') {
  return {drawScreenContour:mode==='screen2d',drawWorldRangeEdges:mode==='bbox3d',depthTest:false as const};
}
export function chooseCloudFitPresentation(state:'complete'|'viewport-cut'|'offscreen'|'depth-empty'|'missing-region') {
  switch(state){
    case 'complete':return 'contour';
    case 'viewport-cut':return 'contour-and-cut-hints';
    case 'offscreen':return 'edge-indicator';
    case 'depth-empty':return 'depth-status-indicator';
    case 'missing-region':return 'legacy-layout';
  }
}

function segmentRectInterval(a:{x:number;y:number},b:{x:number;y:number},r:Rect):[number,number]|null {
  let lo=0,hi=1;
  const constraints:[[number,number],[number,number],[number,number],[number,number]]=[
    [a.x-r.left,b.x-a.x],[r.right-a.x,a.x-b.x],
    [a.y-r.top,b.y-a.y],[r.bottom-a.y,a.y-b.y],
  ];
  for(const [base,delta] of constraints){
    if(delta===0){if(base<0)return null;continue;}
    const t=-base/delta;
    if(delta>0)lo=Math.max(lo,t);else hi=Math.min(hi,t);
    if(lo>hi)return null;
  }
  return [lo,hi];
}
/** Select only parameter intervals that could be visible. Never rebase their s. */
export function visibleCloudPathIntervals(path:RoundedPath,viewport:Rect,expansionPx:number):[number,number][] {
  if(!(expansionPx>=0))throw Error('invalid expansion');
  const r={left:viewport.left-expansionPx,right:viewport.right+expansionPx,top:viewport.top-expansionPx,bottom:viewport.bottom+expansionPx};
  const inside=(x:number,y:number)=>x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;
  const intervals:[number,number][]=[];
  for(const seg of path.segments){
    if(seg.kind==='line'){
      const t=segmentRectInterval(seg.from,seg.to,r);
      if(t)intervals.push([seg.s0+t[0]*seg.length,seg.s0+t[1]*seg.length]);
      continue;
    }
    const ts=[0,1];
    const addAngle=(angle:number)=>{const delta=mod(angle-seg.startAngle,TAU);if(delta<=seg.sweep+1e-10)ts.push(Math.min(1,delta/seg.sweep));};
    for(const x of [r.left,r.right]){const a=(x-seg.center.x)/seg.radius;if(Math.abs(a)<=1){const t=Math.acos(a);addAngle(t);addAngle(-t);}}
    for(const y of [r.top,r.bottom]){const a=(y-seg.center.y)/seg.radius;if(Math.abs(a)<=1){const t=Math.asin(a);addAngle(t);addAngle(Math.PI-t);}}
    const ordered=[...new Set(ts)].sort((a,b)=>a-b);
    for(let i=0;i+1<ordered.length;i++){
      const a=ordered[i],b=ordered[i+1],theta=seg.startAngle+(a+b)/2*seg.sweep;
      if(inside(seg.center.x+seg.radius*Math.cos(theta),seg.center.y+seg.radius*Math.sin(theta)))intervals.push([seg.s0+a*seg.length,seg.s0+b*seg.length]);
    }
  }
  const merged:[number,number][]=[];
  for(const interval of intervals){const prev=merged[merged.length-1];if(prev&&interval[0]<=prev[1]+1e-8)prev[1]=Math.max(prev[1],interval[1]);else merged.push([...interval]);}
  return merged;
}
/** True contour fragments only. Viewport-cut closure lines belong to edge hints,
 * NOT this function; do not turn them into fake revision-cloud boundaries. */
export function buildVisibleCloudPolylines(path:RoundedPath,frame:PhaseFrame,viewport:Rect,amplitudePx=4,stepPx=2,haloWidthPx=8.5):P2[][] {
  if(!(stepPx>0&&amplitudePx>=0&&haloWidthPx>=0))throw Error('invalid screen style');
  const intervals=visibleCloudPathIntervals(path,viewport,amplitudePx+haloWidthPx/2);
  const output:P2[][]=[];
  for(const [lo,hi] of intervals){
    const samples=[lo,hi,...path.segments.flatMap(s=>[s.s0,s.s0+s.length]).filter(s=>s>lo&&s<hi)];
    if(frame.anchorS>lo&&frame.anchorS<hi)samples.push(frame.anchorS);
    const first=Math.ceil(lo/stepPx),count=Math.ceil((hi-lo)/stepPx)+1;
    if(count>200000)throw Error('visible path exceeds sampling budget');
    for(let k=0;k<count;k++){const s=(first+k)*stepPx;if(s<hi)samples.push(s);}
    const points=[...new Set(samples)].sort((a,b)=>a-b).map(s=>{
      const p=atArcLength(path,s),height=cloudHeightAt(s,path.length,frame,amplitudePx);
      return {id:`s:${s}`,x:p.x+p.nx*height,y:p.y+p.ny*height};
    });
    let piece:P2[]=[];
    const flush=()=>{if(piece.length>1)output.push(piece);piece=[];};
    for(let i=0;i+1<points.length;i++){
      const a=points[i],b=points[i+1],t=segmentRectInterval(a,b,viewport);
      if(!t){flush();continue;}
      const mix=(u:number):P2=>({id:`clip:${a.id}:${u}`,x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u});
      const start=mix(t[0]),end=mix(t[1]);
      if(piece.length&&Math.hypot(piece[piece.length-1].x-start.x,piece[piece.length-1].y-start.y)>1e-6)flush();
      if(!piece.length)piece.push(start);piece.push(end);
    }
    flush();
  }
  return output;
}

/** Pure fallback for the rare frame in which no silhouette feature IDs survive.
 * Geometric proximity is authoritative; a 2px tie band uses the previous phase
 * coordinate to avoid switching between nearly coincident candidates.
 */
export function continuingBoundaryPair(previous:{path:RoundedPath;frame:PhaseFrame},current:RoundedPath,tiePx=2):{oldS:number;newS:number;id:string} {
  const oldS=previous.frame.anchorS,point=atArcLength(previous.path,oldS);
  const hint=mod(oldS/previous.path.length*current.length,current.length);
  const candidates:{s:number;distance:number}[]=[];
  const add=(s:number)=>{const q=atArcLength(current,s);candidates.push({s:mod(s,current.length),distance:Math.hypot(q.x-point.x,q.y-point.y)});};
  for(const seg of current.segments){
    if(seg.kind==='line'){
      const dx=seg.to.x-seg.from.x,dy=seg.to.y-seg.from.y;
      const t=Math.max(0,Math.min(1,((point.x-seg.from.x)*dx+(point.y-seg.from.y)*dy)/(seg.length*seg.length)));
      add(seg.s0+t*seg.length);
    }else{
      add(seg.s0);add(seg.s0+seg.length);
      const angle=Math.atan2(point.y-seg.center.y,point.x-seg.center.x),delta=mod(angle-seg.startAngle,TAU);
      if(delta<=seg.sweep)add(seg.s0+delta*seg.radius);
    }
  }
  const best=Math.min(...candidates.map(c=>c.distance));
  const cyclicDistance=(s:number)=>{const d=mod(s-hint,current.length);return Math.min(d,current.length-d);};
  const chosen=candidates.filter(c=>c.distance<=best+tiePx).sort((a,b)=>cyclicDistance(a.s)-cyclicDistance(b.s)||a.distance-b.distance||a.s-b.s)[0];
  if(!chosen)throw Error('empty contour correspondence');
  return {oldS,newS:chosen.s,id:'transported-anchor'};
}
/** For handover only: alpha is passed explicitly (e.g. elapsedMs / 120).
 * Both height fields are evaluated on the CURRENT geometric base; nonnegative
 * blending cannot retract that base into the target. This does not promise
 * material/world locking of every crest while preserving a fixed pixel wavelength.
 */
export function blendedCloudHeightAt(s:number,current:RoundedPath,currentFrame:PhaseFrame,previous:{path:RoundedPath;frame:PhaseFrame},pair:{oldS:number;newS:number},alpha:number,amplitudePx=4):number {
  const oldS=pair.oldS+mod(s-pair.newS,current.length)*previous.path.length/current.length;
  const a=cloudHeightAt(oldS,previous.path.length,previous.frame,amplitudePx);
  const b=cloudHeightAt(s,current.length,currentFrame,amplitudePx);
  const t=smoothstep(alpha);
  return (1-t)*a+t*b;
}
/** Name-compatible additive entry point; leave the legacy rectangle helper alone. */
export const buildCloudBillboardPolylineFromScreen = liftScreenPolylineToBillboard;
```



```json
{
  "scope": "Isolated proposed geometry-kernel checks, not existing project/Vitest tests",
  "passed": 21,
  "results": [
    {
      "name": "front box projects to conservative hull",
      "passed": true
    },
    {
      "name": "crossing near plane never enters legacy fallback",
      "passed": true
    },
    {
      "name": "behind camera and beyond far plane are depth-empty",
      "passed": true
    },
    {
      "name": "camera inside cell still gives a footprint",
      "passed": true
    },
    {
      "name": "solid enclosing the entire frustum retains new clip caps",
      "passed": true
    },
    {
      "name": "individual offscreen objects still form the group envelope",
      "passed": true
    },
    {
      "name": "partial viewport cut retains the actual visible intersection",
      "passed": true
    },
    {
      "name": "sheared local box stays an affine cell, not a reconstructed OBB",
      "passed": true
    },
    {
      "name": "sampled in-slab box points are inside near-clipped projection",
      "passed": true
    },
    {
      "name": "rounded offset length equals perimeter plus 2*pi*padding",
      "passed": true
    },
    {
      "name": "analytic scallops are nonnegative and close continuously",
      "passed": true
    },
    {
      "name": "outward sampled scallops contain hull vertices and edges",
      "passed": true
    },
    {
      "name": "collinear hull insertion and input order cannot reset phase",
      "passed": true
    },
    {
      "name": "feature disappearance transports analytic phase at surviving feature",
      "passed": true
    },
    {
      "name": "orthographic worldPerPixel ignores depth and accounts for zoom",
      "passed": true
    },
    {
      "name": "billboard inverse projection round-trips CSS coordinates",
      "passed": true
    },
    {
      "name": "perspective lasso produces widening depth frusta",
      "passed": true
    },
    {
      "name": "orthographic lasso uses distinct ray origins and parallel extrusion",
      "passed": true
    },
    {
      "name": "long thin silhouettes do not become tiny-target icons",
      "passed": true
    },
    {
      "name": "huge footprint enclosing viewport draws hints, not a fake cloud rectangle",
      "passed": true
    },
    {
      "name": "huge offscreen perimeter is sampled only near viewport",
      "passed": true
    }
  ]
}
```

