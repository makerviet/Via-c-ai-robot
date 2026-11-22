"""Ghép tay SO-101 lên đế VIA C v2.0 và xuất mô hình 3D có màu (.glb) cho nông trang ảo.

Cách chạy:
    git clone https://github.com/TheRobotStudio/SO-ARM100
    python hardware/v0.1/tao_mo_hinh.py --base de_v2.0.stl --so101 SO-ARM100/Simulation/SO101

Cần: pip install trimesh fast-simplification networkx
Toạ độ theo ROS (x tới trước, z lên trên), cuối cùng xoay sang trục y-lên của glTF.
"""
import argparse, json, sys
import xml.etree.ElementTree as ET
import numpy as np, trimesh
from trimesh.transformations import euler_matrix, rotation_matrix
from trimesh.visual.material import PBRMaterial
import fast_simplification as fs

def T(o):
    xyz=[float(v) for v in (o.get('xyz') or '0 0 0').split()]
    rpy=[float(v) for v in (o.get('rpy') or '0 0 0').split()]
    M=euler_matrix(*rpy,'sxyz'); M[:3,3]=xyz; return M
def fk(q, U):
    joints=U.findall('joint')
    W={'base_link':np.eye(4)}
    changed=True
    while changed:
        changed=False
        for j in joints:
            p=j.find('parent').get('link'); c=j.find('child').get('link')
            if p in W and c not in W:
                M=W[p]@T(j.find('origin'))
                if j.get('type')=='revolute':
                    M=M@rotation_matrix(q.get(j.get('name'),0),[0,0,1])
                W[c]=M; changed=True
    return W
def parts(q, U):
    W=fk(q, U); out=[]
    for l in U.findall('link'):
        n=l.get('name')
        for v in l.findall('visual'):
            f=v.find('geometry/mesh').get('filename')
            mat=v.find('material'); mn=mat.get('name') if mat is not None else ''
            out.append((n,f,W[n]@T(v.find('origin')),mn))
    return W,out

RISER=0.12; MOUNT_X=-0.06; TOP=0.235
def dec(m,target):
    if len(m.faces)<=target: return m
    v,f=fs.simplify(m.vertices.astype(np.float32),m.faces.astype(np.int32),target_reduction=1-target/len(m.faces))
    return trimesh.Trimesh(v,f,process=False)
def mat(hexc,rough=0.6,metal=0.0,alpha=1.0):
    c=[(hexc>>16&255)/255,(hexc>>8&255)/255,(hexc&255)/255,alpha]
    return PBRMaterial(baseColorFactor=c,roughnessFactor=rough,metallicFactor=metal,alphaMode='BLEND' if alpha<1 else 'OPAQUE',doubleSided=True)
COL=dict(shell=0xEEE7D2, chassis=0x5B8F3A, wheel=0x2A2A2A, hub=0x9AA0A6, bracket=0x7D8288, board=0x2E5E4A, cam=0x1E1E1E,
         riser=0xB9BEC4, printed=0x8DBF4A, servo=0x1C1C1C)
def classify(c):
    b=c.bounds; ctr=c.centroid; size=b[1]-b[0]
    if abs(ctr[1])>0.1 and size[2]>0.15: return 'wheel'
    if b[1][2]<0 : return 'bracket'
    if size[0]>0.2 and size[2]>0.1 and b[0][2]>0.1: return 'shell'
    if size[0]>0.2 and b[0][2]<0.01: return 'chassis'
    if b[0][0]>0.09 and b[0][2]>0.18: return 'cam'
    if b[0][2]<0.12 and size[2]>0.1: return 'bracket'
    return 'board'
def build(q, out, base_stl, D, base_target=60000, arm_ratio=0.25):
    U=ET.parse(D+'so101_new_calib.urdf').getroot()
    sc=trimesh.Scene()
    base=trimesh.load(base_stl)
    groups={}
    for c in base.split(only_watertight=False):
        groups.setdefault(classify(c),[]).append(c)
    total=len(base.faces)
    for k,cs in groups.items():
        m=trimesh.util.concatenate(cs)
        if len(m.faces)>12000: m=dec(m,max(12000,int(base_target*len(m.faces)/total)))
        m.visual=trimesh.visual.TextureVisuals(material=mat(COL[k],0.5 if k!='wheel' else 0.9))
        sc.add_geometry(m,node_name='base_'+k,geom_name='base_'+k)
    # cột nâng nhôm định hình 40x40
    r=trimesh.creation.box([0.04,0.04,RISER]); r.apply_translation([MOUNT_X,0,TOP+RISER/2])
    p=trimesh.creation.box([0.12,0.09,0.006]); p.apply_translation([MOUNT_X+0.01,0,TOP+RISER+0.003])
    f=trimesh.creation.box([0.08,0.08,0.006]); f.apply_translation([MOUNT_X,0,TOP+0.003])
    rm=trimesh.util.concatenate([r,p,f]); rm.visual=trimesh.visual.TextureVisuals(material=mat(COL['riser'],0.4,0.3))
    sc.add_geometry(rm,node_name='riser',geom_name='riser')
    M0=np.eye(4); M0[:3,3]=[MOUNT_X,0,TOP+RISER+0.006+0.0024]
    if 'xoan' in q:  # tay mềm xoắn thay cho SO-101
        for name, m, c in spiral_arm(**q['xoan']):
            m.visual = trimesh.visual.TextureVisuals(material=mat(c, 0.7))
            sc.add_geometry(m, node_name=name, geom_name=name)
        sc.apply_transform(trimesh.transformations.rotation_matrix(-np.pi/2,[1,0,0]))
        sc.export(out); return None, None
    dx = q.pop('dau_xoan', None)
    W,P=parts(q, U)
    cache={}
    if dx:  # đầu xoắn nhỏ thay ngàm động của SO-101, cáp cuốn vào trục servo kẹp sẵn có
        J = M0 @ W['moving_jaw_so101_v1_link']; G = M0 @ W['gripper_link']; F = M0 @ W['gripper_frame_link']
        d0 = F[:3, 3] - G[:3, 3]
        segs, cab, vol = spiral_chain(J[:3, 3] + 0.01 * d0 / np.linalg.norm(d0), d0, dx.get('sign', 1) * J[:3, 2],
                                      dx['curl'], dx['n'], dx['length'], dx['w0'], dx['w1'], sides=16)
        for name, m, c in [('dau_xoan', trimesh.util.concatenate(segs), 0xF1ECDD), ('cap_dau_xoan', cab, 0x8A5A2B)] + \
                (lemon_at(np.mean(np.array([x.centroid for x in segs[dx['n'] // 3:]]), axis=0), dx.get('lemon', 0.8)) if dx.get('lemon') else []):
            m.visual = trimesh.visual.TextureVisuals(material=mat(c, 0.7)); sc.add_geometry(m, node_name=name, geom_name=name)
        print(f"đầu xoắn: thể tích đặc {vol*1e6:.1f} cm3, ước {vol*1e6*1.2*0.6:.0f} g nếu in TPU đặc 60%")
        P = [p for p in P if p[0] != 'moving_jaw_so101_v1_link']
    for i,(link,fn,M,mn) in enumerate(P):
        if fn not in cache:
            m=trimesh.load(D+fn); cache[fn]=dec(m,max(500,int(len(m.faces)*arm_ratio)))
        m=cache[fn].copy(); m.apply_transform(M0@M)
        m.visual=trimesh.visual.TextureVisuals(material=mat(COL['servo'] if mn=='sts3215' else COL['printed'],0.55))
        sc.add_geometry(m,node_name=f'{link}_{i}',geom_name=f'{link}_{i}')
    # đổi trục z-lên sang y-lên cho glTF
    sc.apply_transform(trimesh.transformations.rotation_matrix(-np.pi/2,[1,0,0]))
    sc.export(out)
    allm=trimesh.util.concatenate([g for g in sc.dump()])
    return allm.bounds, {k:(M0@W[k])[:3,3].round(3).tolist() for k in ['shoulder_link','gripper_frame_link']}
def frustum(r0, r1, h, sides=24):
    return trimesh.creation.revolve([[0, 0], [r0, 0], [r1, h], [0, h]], sections=sides)

def spiral_chain(p0, d0, nrm, curl, n, length, w0, w1, sides=24):
    """Chuỗi đốt xoắn ốc logarit: mỗi đốt nhỏ hơn đốt trước một tỉ lệ q, kéo cáp thì mọi khớp
    gập cùng một góc `curl` quanh trục `nrm`, nên cả chuỗi cuộn thành đường xoắn ốc logarit.
    Hình học tự dựng theo nguyên lý trong bài báo SpiRobs, không lấy mã hay bản vẽ của repo khác.
    Trả về các đốt, 3 sợi cáp và thể tích đặc (m3) để ước khối lượng."""
    q = (w1 / w0) ** (1 / n)
    l0 = length * (1 - q) / (1 - q ** n)
    pos = np.array(p0, float); d0 = np.array(d0, float) / np.linalg.norm(d0)
    segs = []; cables = [[], [], []]; vol = 0.0
    for i in range(n):
        li, ri, rj = l0 * q ** i, w0 * q ** i / 2, w0 * q ** (i + 1) / 2
        d = rotation_matrix(i * curl, nrm)[:3, :3] @ d0
        m = frustum(ri, rj, li * 0.86, sides)
        R = trimesh.geometry.align_vectors([0, 0, 1], d); R[:3, 3] = pos
        m.apply_transform(R); segs.append(m)
        vol += np.pi * li * 0.86 * (ri * ri + ri * rj + rj * rj) / 3
        for k in range(3):  # 3 sợi cáp chạy dọc mép đốt
            a = 2 * np.pi * k / 3
            cables[k].append(pos + R[:3, :3] @ np.array([np.cos(a) * ri * 0.8, np.sin(a) * ri * 0.8, 0]))
        pos = pos + d * li
    cab = []
    for c in cables:
        for a, b in zip(c[:-1], c[1:]):
            v = b - a; L = np.linalg.norm(v)
            if L < 1e-4: continue
            cy = trimesh.creation.cylinder(radius=max(0.0006, w1 * 0.12), height=L, sections=6)
            T = trimesh.geometry.align_vectors([0, 0, 1], v / L); T[:3, 3] = (a + b) / 2; cy.apply_transform(T); cab.append(cy)
    return segs, trimesh.util.concatenate(cab), vol

def lemon_at(ctr, scale=1.0):
    L = trimesh.creation.icosphere(subdivisions=3, radius=1.0); L.apply_scale(np.array([0.026, 0.026, 0.032]) * scale)
    L.apply_translation(ctr)
    st = trimesh.creation.cylinder(radius=0.0025, height=0.05, sections=6); st.apply_translation(ctr + [0, 0, 0.032 * scale + 0.025])
    return [('qua_chanh', L, 0xF2D52A), ('cuong_chanh', st, 0x6B5A3E)]

def spiral_arm(curl=0.22, tilt=0.35, n=22, length=0.42, w0=0.05, w1=0.008, lemon=False):
    """Tay mềm xoắn dài 42 cm thay cho SO-101, hộp 3 động cơ kéo cáp đặt trên đỉnh cột."""
    out = []
    top = TOP + RISER + 0.006
    box = trimesh.creation.box([0.09, 0.08, 0.06]); box.apply_translation([MOUNT_X + 0.005, 0, top + 0.03])
    out.append(('hop_keo_cap', box, 0x2F3A2A))
    segs, cab, vol = spiral_chain([MOUNT_X + 0.05, 0.0, top + 0.035], [np.cos(tilt), 0, np.sin(tilt)], [0, 1, 0], curl, n, length, w0, w1)
    out += [('tay_xoan', trimesh.util.concatenate(segs), 0xF1ECDD), ('cap_keo', cab, 0x8A5A2B)]
    if lemon: out += lemon_at(np.mean(np.array([s.centroid for s in segs[n // 3:]]), axis=0))
    return out

def build_khop(out, base_stl, D, base_target=60000, arm_ratio=0.25):
    """Mô hình có khớp cho nông trang ảo: mỗi khâu SO-101 là một nút riêng tên `so101_<khâu>`,
    lồng nhau theo URDF. Trang web chỉ cần đặt rotation.z của nút khâu con bằng góc khớp (rad)."""
    U = ET.parse(D + 'so101_new_calib.urdf').getroot()
    sc = trimesh.Scene()
    g = sc.graph; root = 'via_c'
    g.update(frame_from=sc.graph.base_frame, frame_to=root, matrix=rotation_matrix(-np.pi / 2, [1, 0, 0]))
    base = trimesh.load(base_stl); groups = {}
    for c in base.split(only_watertight=False):
        groups.setdefault(classify(c), []).append(c)
    total = len(base.faces)
    for k, cs in groups.items():
        m = trimesh.util.concatenate(cs)
        if len(m.faces) > 12000: m = dec(m, max(12000, int(base_target * len(m.faces) / total)))
        m.visual = trimesh.visual.TextureVisuals(material=mat(COL[k], 0.5 if k != 'wheel' else 0.9))
        sc.add_geometry(m, node_name='base_' + k, geom_name='base_' + k, parent_node_name=root)
    r = trimesh.creation.box([0.04, 0.04, RISER]); r.apply_translation([MOUNT_X, 0, TOP + RISER / 2])
    p = trimesh.creation.box([0.12, 0.09, 0.006]); p.apply_translation([MOUNT_X + 0.01, 0, TOP + RISER + 0.003])
    f = trimesh.creation.box([0.08, 0.08, 0.006]); f.apply_translation([MOUNT_X, 0, TOP + 0.003])
    rm = trimesh.util.concatenate([r, p, f]); rm.visual = trimesh.visual.TextureVisuals(material=mat(COL['riser'], 0.4, 0.3))
    sc.add_geometry(rm, node_name='riser', geom_name='riser', parent_node_name=root)
    M0 = np.eye(4); M0[:3, 3] = [MOUNT_X, 0, TOP + RISER + 0.006 + 0.0024]
    g.update(frame_from=root, frame_to='so101_base_link', matrix=M0)
    for j in U.findall('joint'):  # nút khớp mang gốc toạ độ cố định, nút khâu con xoay quanh z
        pa, ch = 'so101_' + j.find('parent').get('link'), 'so101_' + j.find('child').get('link')
        g.update(frame_from=pa, frame_to='khop_' + j.get('name'), matrix=T(j.find('origin')))
        g.update(frame_from='khop_' + j.get('name'), frame_to=ch, matrix=np.eye(4))
    cache = {}
    for l in U.findall('link'):
        for i, v in enumerate(l.findall('visual')):
            fn = v.find('geometry/mesh').get('filename'); mt = v.find('material')
            if fn not in cache:
                m = trimesh.load(D + fn); cache[fn] = dec(m, max(500, int(len(m.faces) * arm_ratio)))
            m = cache[fn].copy()
            servo = mt is not None and mt.get('name') == 'sts3215'
            m.visual = trimesh.visual.TextureVisuals(material=mat(COL['servo'] if servo else COL['printed'], 0.55))
            name = f"hinh_{l.get('name')}_{i}"
            sc.add_geometry(m, node_name=name, geom_name=name, parent_node_name='so101_' + l.get('name'), transform=T(v.find('origin')))
    sc.export(out)

POSES = {  # góc khớp (rad) cho ba tư thế mẫu
    'via_c_v0_1':     dict(shoulder_lift=-0.25, elbow_flex=0.95, wrist_flex=0.75, gripper=0.15),             # sẵn sàng
    'via_c_v0_1_hai': dict(shoulder_pan=0.25, shoulder_lift=0.55, elbow_flex=-0.2, wrist_flex=0.35, gripper=0.9),  # vươn hái
    'via_c_v0_1_gap': dict(shoulder_lift=-1.7, elbow_flex=1.65, wrist_flex=0.8, gripper=0),                   # gập khi di chuyển
    # Tay mềm xoắn tạm gác (docs/TAY-MEM-XOAN.md). Tư thế mẫu nếu cần dựng lại:
    #   dict(xoan=dict(curl=0.3, tilt=0.75, w0=0.055, lemon=True))
    #   dict(shoulder_lift=0.35, elbow_flex=0.1, wrist_flex=0.9, dau_xoan=dict(sign=-1, curl=0.42, n=16, length=0.16, w0=0.024, w1=0.005, lemon=0.8))
}
if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--base', required=True, help='file STL đế xuất từ Onshape (mét, z lên trên)')
    ap.add_argument('--so101', required=True, help='thư mục Simulation/SO101 của repo TheRobotStudio/SO-ARM100')
    ap.add_argument('--out', default='sim/web/models')
    a = ap.parse_args()
    build_khop(f'{a.out}/via_c_v0_1_khop.glb', a.base, a.so101.rstrip('/') + '/')
    for name, q in POSES.items():
        print(name, build(q, f'{a.out}/{name}.glb', a.base, a.so101.rstrip('/') + '/'))
