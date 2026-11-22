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
    W,P=parts(q, U)
    cache={}
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
POSES = {  # góc khớp (rad) cho ba tư thế mẫu
    'via_c_v0_1':     dict(shoulder_lift=-0.25, elbow_flex=0.95, wrist_flex=0.75, gripper=0.15),             # sẵn sàng
    'via_c_v0_1_hai': dict(shoulder_pan=0.25, shoulder_lift=0.55, elbow_flex=-0.2, wrist_flex=0.35, gripper=0.9),  # vươn hái
    'via_c_v0_1_gap': dict(shoulder_lift=-1.7, elbow_flex=1.65, wrist_flex=0.8, gripper=0),                   # gập khi di chuyển
}
if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--base', required=True, help='file STL đế xuất từ Onshape (mét, z lên trên)')
    ap.add_argument('--so101', required=True, help='thư mục Simulation/SO101 của repo TheRobotStudio/SO-ARM100')
    ap.add_argument('--out', default='sim/web/models')
    a = ap.parse_args()
    for name, q in POSES.items():
        print(name, build(q, f'{a.out}/{name}.glb', a.base, a.so101.rstrip('/') + '/'))
