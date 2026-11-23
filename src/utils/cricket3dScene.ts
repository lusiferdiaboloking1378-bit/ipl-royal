import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { getPlayerPhotoSrc } from '../data/playerPhotos';
import { BallEvent, DeliveryType, Franchise, PlayerRole, ShotStyle } from '../types/game';

export type ShotDirection3D = 'OFF' | 'STRAIGHT' | 'LEG';
export type AnimStage3D = 'IDLE' | 'RUNUP' | 'DELIVERY' | 'FLIGHT';
export type CameraPreset3D = 'TV' | 'BOTH_FACES' | 'BOWLER';

export interface CricketerVisual {
  id: string;
  name: string;
  jerseyNumber: number;
  role: PlayerRole;
  battingHand: 'RHB' | 'LHB';
}

export interface FlightVisual3D {
  outcome: BallEvent['outcome'];
  direction: ShotDirection3D;
  delivery: DeliveryType;
  shot: ShotStyle;
  label: string;
}

export interface LiveSceneState {
  stage: AnimStage3D;
  stageElapsed: number;
  runupDur: number;
  deliveryDur: number;
  flightDur: number;
  direction: ShotDirection3D;
  selectedDelivery: DeliveryType;
  isUserBatting: boolean;
  waitingText: string | null;
  cameraPreset: CameraPreset3D;
  flight: FlightVisual3D;
  battingFranchise: Franchise;
  bowlingFranchise: Franchise;
  batter: CricketerVisual;
  bowler: CricketerVisual;
}

interface CricketerRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  torsoMesh: THREE.Mesh;
  jerseyTrimMesh: THREE.Mesh;
  jerseyBackMat: THREE.MeshStandardMaterial;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  headGroup: THREE.Group;
  faceDiscMat: THREE.MeshStandardMaterial;
  faceRimMat: THREE.MeshStandardMaterial;
  helmetOrCapGroup: THREE.Group;
  helmetMat: THREE.MeshStandardMaterial;
  batPivot: THREE.Group;
  handBallMesh: THREE.Mesh;
  nameSpriteMat: THREE.SpriteMaterial;
  lastKey: string;
}

// Pre-allocated math helpers (zero per-frame allocations)
const _camTargetPos = new THREE.Vector3();
const _camLookAtPos = new THREE.Vector3();
const _currentLookAt = new THREE.Vector3(0, 1.3, 4.0);
const _tempVecA = new THREE.Vector3();
const _tempVecB = new THREE.Vector3();

// Cache player face CanvasTextures by playerId + accent colors so swapping batters/bowlers never leaks textures
const faceTextureCache = new Map<string, THREE.CanvasTexture>();
const jerseyTextureCache = new Map<string, THREE.CanvasTexture>();
const nameTextureCache = new Map<string, THREE.CanvasTexture>();

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'PL';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function getSurname(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[parts.length - 1] || name).toUpperCase().slice(0, 11);
}

function hashSkinTone(id: string): { skin: string; shade: string; hair: string } {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  const tones = [
    { skin: '#D49A6A', shade: '#B67B4B', hair: '#1E1B18' },
    { skin: '#C68642', shade: '#A0642A', hair: '#171513' },
    { skin: '#E5B28A', shade: '#C98F66', hair: '#2D2218' },
    { skin: '#9E6B47', shade: '#7D4E30', hair: '#141210' },
    { skin: '#F0C5A2', shade: '#D4A17A', hair: '#4A3728' },
  ];
  return tones[Math.abs(h) % tones.length];
}

function drawFallbackPortrait(
  ctx: CanvasRenderingContext2D,
  size: number,
  player: CricketerVisual,
  primaryColor: string,
  secondaryColor: string
) {
  const tone = hashSkinTone(player.id);
  const cx = size / 2;
  const cy = size / 2;

  ctx.clearRect(0, 0, size, size);

  // Subtle stadium radial backdrop inside circular portrait
  const bg = ctx.createRadialGradient(cx, cy * 0.8, size * 0.08, cx, cy, size * 0.52);
  bg.addColorStop(0, secondaryColor);
  bg.addColorStop(1, primaryColor);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  // Shoulders / jersey collar
  ctx.fillStyle = primaryColor;
  ctx.beginPath();
  ctx.ellipse(cx, size * 0.92, size * 0.36, size * 0.22, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = secondaryColor;
  ctx.lineWidth = 6;
  ctx.stroke();

  // Neck
  ctx.fillStyle = tone.shade;
  ctx.fillRect(cx - 18, cy + 32, 36, 40);

  // Head oval
  ctx.fillStyle = tone.skin;
  ctx.beginPath();
  ctx.ellipse(cx, cy - 4, size * 0.25, size * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Hair / brow cap
  ctx.fillStyle = tone.hair;
  ctx.beginPath();
  ctx.ellipse(cx, cy - size * 0.2, size * 0.245, size * 0.14, 0, Math.PI, Math.PI * 2);
  ctx.fill();

  // Eyes & eyebrows
  ctx.fillStyle = tone.hair;
  ctx.fillRect(cx - 32, cy - 22, 20, 5);
  ctx.fillRect(cx + 12, cy - 22, 20, 5);

  ctx.fillStyle = '#111827';
  ctx.beginPath();
  ctx.arc(cx - 22, cy - 8, 5.5, 0, Math.PI * 2);
  ctx.arc(cx + 22, cy - 8, 5.5, 0, Math.PI * 2);
  ctx.fill();

  // Nose & confident grin
  ctx.strokeStyle = tone.shade;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 8);
  ctx.lineTo(cx - 3, cy + 12);
  ctx.lineTo(cx + 4, cy + 14);
  ctx.stroke();

  ctx.strokeStyle = '#7C2D12';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy + 20, 16, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  // Initials badge on lower chin rim so likeness is always readable
  ctx.fillStyle = 'rgba(8, 13, 26, 0.84)';
  ctx.fillRect(0, size - 44, size, 44);
  ctx.fillStyle = '#F8FAFC';
  ctx.font = 'bold 26px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${getInitials(player.name)} · #${player.jerseyNumber}`, cx, size - 22);
}

function getOrBuildPlayerFaceTexture(
  player: CricketerVisual,
  primaryColor: string,
  secondaryColor: string
): THREE.CanvasTexture {
  const key = `${player.id}|${primaryColor}|${secondaryColor}`;
  const existing = faceTextureCache.get(key);
  if (existing) return existing;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    drawFallbackPortrait(ctx, size, player, primaryColor, secondaryColor);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  faceTextureCache.set(key, tex);

  const photoUrl = getPlayerPhotoSrc(player.id);
  if (photoUrl && ctx) {
    const img = new Image();
    img.onload = () => {
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      if (iw > 0 && ih > 0) {
        ctx.clearRect(0, 0, size, size);
        // Dark crisp frame behind portrait
        ctx.fillStyle = '#0F172A';
        ctx.fillRect(0, 0, size, size);

        // Cover-crop focused on upper-center (face)
        const scale = Math.max(size / iw, size / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        const dx = (size - dw) / 2;
        const dy = Math.min(0, (size - dh) * 0.2);
        ctx.drawImage(img, dx, dy, dw, dh);

        // Subtle rim vignette to blend nicely into 3D face medallion
        ctx.strokeStyle = secondaryColor;
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 5, 0, Math.PI * 2);
        ctx.stroke();

        tex.needsUpdate = true;
      }
    };
    img.src = photoUrl;
  }

  return tex;
}

function getOrBuildJerseyTexture(
  player: CricketerVisual,
  primaryColor: string,
  secondaryColor: string,
  textOnPrimary: string
): THREE.CanvasTexture {
  const key = `${player.id}|${player.jerseyNumber}|${primaryColor}|${secondaryColor}`;
  const existing = jerseyTextureCache.get(key);
  if (existing) return existing;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = primaryColor;
    ctx.fillRect(0, 0, 256, 256);

    // Shoulder stripe accent
    ctx.fillStyle = secondaryColor;
    ctx.fillRect(0, 0, 256, 28);
    ctx.fillRect(0, 232, 256, 24);

    // Surname
    ctx.fillStyle = textOnPrimary || '#FFFFFF';
    ctx.font = 'bold 34px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(getSurname(player.name), 128, 76);

    // Jersey Number
    ctx.fillStyle = secondaryColor;
    ctx.font = '900 108px system-ui, -apple-system, sans-serif';
    ctx.fillText(`${player.jerseyNumber}`, 128, 166);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  jerseyTextureCache.set(key, tex);
  return tex;
}

function getOrBuildNameTexture(
  player: CricketerVisual,
  primaryColor: string,
  secondaryColor: string
): THREE.CanvasTexture {
  const key = `name|${player.id}|${player.jerseyNumber}|${primaryColor}|${secondaryColor}`;
  const existing = nameTextureCache.get(key);
  if (existing) return existing;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = 'rgba(8, 13, 26, 0.9)';
    ctx.strokeStyle = secondaryColor;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(6, 6, 244, 52, 14);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#F8FAFC';
    ctx.font = 'bold 26px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${getSurname(player.name)} #${player.jerseyNumber}`, 128, 33);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  nameTextureCache.set(key, tex);
  return tex;
}

function buildGrassTexture(maxAniso: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Mowed outfield stripes
    const stripes = 16;
    const stripeW = size / stripes;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#126E3E' : '#0E5C33';
      ctx.fillRect(0, i * stripeW, size, stripeW);
    }
    // Subtle grass grain
    for (let i = 0; i < 4000; i++) {
      const gx = (i * 73) % size;
      const gy = (i * 137) % size;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
      ctx.fillRect(gx, gy, 2, 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.anisotropy = Math.min(8, maxAniso);
  return tex;
}

function buildPitchTexture(maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, 1024);
    grad.addColorStop(0, '#BC9768');
    grad.addColorStop(0.5, '#D1AF82');
    grad.addColorStop(1, '#BA9566');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 1024);

    // Subtle pitch wear patches near good-length zones
    ctx.fillStyle = 'rgba(120, 82, 42, 0.22)';
    ctx.beginPath();
    ctx.ellipse(128, 260, 42, 75, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(128, 760, 44, 75, 0, 0, Math.PI * 2);
    ctx.fill();

    // White crease markings
    ctx.strokeStyle = '#F8FAFC';
    ctx.lineWidth = 6;

    // Bowling-end creases (top)
    ctx.beginPath();
    ctx.moveTo(18, 76);
    ctx.lineTo(238, 76);
    ctx.moveTo(8, 128);
    ctx.lineTo(248, 128);
    // Return creases
    ctx.moveTo(48, 42);
    ctx.lineTo(48, 128);
    ctx.moveTo(208, 42);
    ctx.lineTo(208, 128);

    // Batting-end creases (bottom)
    ctx.moveTo(18, 948);
    ctx.lineTo(238, 948);
    ctx.moveTo(8, 896);
    ctx.lineTo(248, 896);
    ctx.moveTo(48, 896);
    ctx.lineTo(48, 982);
    ctx.moveTo(208, 896);
    ctx.lineTo(208, 982);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAniso);
  return tex;
}

function buildPerimeterLedTexture(
  batShort: string,
  bowlShort: string,
  batColor: string,
  bowlColor: string
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#091224';
    ctx.fillRect(0, 0, 2048, 128);

    const panels = [
      { label: `${batShort} VS ${bowlShort} · LIVE`, bg: batColor, fg: '#FFFFFF' },
      { label: 'IPL AUCTION SHOWDOWN 3D', bg: '#0F172A', fg: '#FBBF24' },
      { label: `${bowlShort} BOWLING ATTACK`, bg: bowlColor, fg: '#FFFFFF' },
      { label: 'MAXIMUM 6 · SUPER OVER ARENA', bg: '#111827', fg: '#34D399' },
    ];
    const w = 2048 / panels.length;
    panels.forEach((p, idx) => {
      ctx.fillStyle = p.bg;
      ctx.fillRect(idx * w, 8, w - 8, 112);
      ctx.fillStyle = p.fg;
      ctx.font = 'bold 34px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.label, idx * w + (w - 8) / 2, 64);
    });
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  return tex;
}

function createCricketerRig(
  isBatter: boolean,
  castShadow: boolean
): CricketerRig {
  const root = new THREE.Group();

  // Contact shadow disc
  const shadowDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 24),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    })
  );
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.y = 0.025;
  root.add(shadowDisc);

  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const jerseyMat = new THREE.MeshStandardMaterial({
    color: '#1D4ED8',
    roughness: 0.62,
    metalness: 0.05,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: '#FBBF24',
    roughness: 0.48,
    metalness: 0.15,
  });
  const trouserMat = new THREE.MeshStandardMaterial({
    color: '#1E293B',
    roughness: 0.7,
    metalness: 0.05,
  });
  const padOrLegMat = isBatter
    ? new THREE.MeshStandardMaterial({ color: '#F1F5F9', roughness: 0.42, metalness: 0.05 })
    : trouserMat;
  const shoeMat = new THREE.MeshStandardMaterial({
    color: '#FFFFFF',
    roughness: 0.45,
    metalness: 0.08,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: '#D49A6A',
    roughness: 0.65,
    metalness: 0.02,
  });

  // Legs (hips at y = 0.88; leg extends down 0.88 so bottom of shoe sits cleanly at y = 0)
  const makeLeg = (xOff: number): THREE.Group => {
    const legPivot = new THREE.Group();
    legPivot.position.set(xOff, 0.88, 0);

    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.095, 0.44, 12), trouserMat);
    thigh.position.y = -0.22;
    thigh.castShadow = castShadow;
    legPivot.add(thigh);

    const shin = new THREE.Mesh(
      isBatter
        ? new THREE.BoxGeometry(0.21, 0.42, 0.22)
        : new THREE.CylinderGeometry(0.085, 0.072, 0.4, 12),
      padOrLegMat
    );
    shin.position.set(0, -0.63, isBatter ? 0.03 : 0);
    shin.castShadow = castShadow;
    legPivot.add(shin);

    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.3), shoeMat);
    shoe.position.set(0, -0.825, 0.06);
    shoe.castShadow = castShadow;
    legPivot.add(shoe);

    return legPivot;
  };

  const leftLegPivot = makeLeg(-0.15);
  const rightLegPivot = makeLeg(0.15);
  bodyGroup.add(leftLegPivot, rightLegPivot);

  // Pelvis
  const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.22, 0.22, 14), trouserMat);
  pelvis.position.y = 0.96;
  pelvis.castShadow = castShadow;
  bodyGroup.add(pelvis);

  // Torso
  const torsoMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.23, 0.62, 16), jerseyMat);
  torsoMesh.position.y = 1.36;
  torsoMesh.castShadow = castShadow;
  bodyGroup.add(torsoMesh);

  // Chest/shoulder accent collar
  const jerseyTrimMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.285, 0.275, 0.12, 16), trimMat);
  jerseyTrimMesh.position.y = 1.62;
  bodyGroup.add(jerseyTrimMesh);

  // Jersey back plate (surname + jersey number)
  const jerseyBackMat = new THREE.MeshStandardMaterial({
    color: '#FFFFFF',
    roughness: 0.55,
    metalness: 0.04,
  });
  const backPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.44), jerseyBackMat);
  backPlate.position.set(0, 1.36, -0.27);
  backPlate.rotation.y = Math.PI;
  bodyGroup.add(backPlate);

  // Arms
  const gloveOrHandMat = isBatter
    ? new THREE.MeshStandardMaterial({ color: '#F8FAFC', roughness: 0.45 })
    : skinMat;

  const makeArm = (xOff: number): THREE.Group => {
    const armPivot = new THREE.Group();
    armPivot.position.set(xOff, 1.58, 0);

    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.078, 0.26, 12), jerseyMat);
    sleeve.position.y = -0.12;
    sleeve.castShadow = castShadow;
    armPivot.add(sleeve);

    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.056, 0.28, 12), skinMat);
    forearm.position.y = -0.37;
    forearm.castShadow = castShadow;
    armPivot.add(forearm);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 12), gloveOrHandMat);
    hand.position.y = -0.53;
    hand.castShadow = castShadow;
    armPivot.add(hand);

    return armPivot;
  };

  const leftArmPivot = makeArm(-0.34);
  const rightArmPivot = makeArm(0.34);
  bodyGroup.add(leftArmPivot, rightArmPivot);

  // 3D Cricket Bat attached to rightArmPivot (hidden for bowler)
  const batPivot = new THREE.Group();
  batPivot.position.set(0, -0.53, 0.04);
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.028, 0.34, 10),
    new THREE.MeshStandardMaterial({ color: '#1E293B', roughness: 0.65 })
  );
  handle.position.y = -0.14;
  const willowMat = new THREE.MeshStandardMaterial({
    color: '#F3D299',
    roughness: 0.44,
    metalness: 0.05,
  });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.68, 0.055), willowMat);
  blade.position.y = -0.62;
  blade.castShadow = castShadow;
  const batSticker = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.24, 0.062), trimMat);
  batSticker.position.y = -0.52;
  batPivot.add(handle, blade, batSticker);
  batPivot.visible = isBatter;
  rightArmPivot.add(batPivot);

  // Bowler's cricket ball in hand
  const handBallMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.068, 14, 14),
    new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.32, metalness: 0.1 })
  );
  handBallMesh.position.set(0, -0.56, 0.04);
  handBallMesh.visible = !isBatter;
  rightArmPivot.add(handBallMesh);

  // Head Group + REAL AUCTIONED PLAYER FACE MEDALLION
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.94, 0);
  bodyGroup.add(headGroup);

  const headSphere = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 20), skinMat);
  headSphere.castShadow = castShadow;
  headGroup.add(headSphere);

  // Prominent Front Face Portrait Disc + Team-colored Bezel Ring (displays actual drafted player photo!)
  const faceRimMat = new THREE.MeshStandardMaterial({
    color: '#FBBF24',
    roughness: 0.32,
    metalness: 0.45,
  });
  const faceRim = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.032, 12, 32), faceRimMat);
  faceRim.position.set(0, 0.02, 0.235);
  headGroup.add(faceRim);

  const faceDiscMat = new THREE.MeshStandardMaterial({
    color: '#FFFFFF',
    roughness: 0.38,
    metalness: 0.02,
  });
  const faceDisc = new THREE.Mesh(new THREE.CircleGeometry(0.265, 32), faceDiscMat);
  faceDisc.position.set(0, 0.02, 0.242);
  headGroup.add(faceDisc);

  // Helmet (Batter) or Team Cap (Bowler)
  const helmetOrCapGroup = new THREE.Group();
  const helmetMat = new THREE.MeshStandardMaterial({
    color: '#1D4ED8',
    roughness: 0.35,
    metalness: 0.25,
  });

  if (isBatter) {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.265, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.52),
      helmetMat
    );
    dome.position.y = 0.04;
    dome.castShadow = castShadow;
    const peak = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.03, 0.16), helmetMat);
    peak.position.set(0, 0.21, 0.2);
    peak.rotation.x = 0.15;
    helmetOrCapGroup.add(dome, peak);
  } else {
    const capDome = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.46),
      helmetMat
    );
    capDome.position.y = 0.05;
    capDome.castShadow = castShadow;
    const capPeak = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.025, 0.16), helmetMat);
    capPeak.position.set(0, 0.19, 0.2);
    capPeak.rotation.x = 0.12;
    helmetOrCapGroup.add(capDome, capPeak);
  }
  headGroup.add(helmetOrCapGroup);

  // Crisp floating nameplate above head
  const nameSpriteMat = new THREE.SpriteMaterial({
    color: 0xffffff,
    transparent: true,
    depthTest: true,
  });
  const nameSprite = new THREE.Sprite(nameSpriteMat);
  nameSprite.position.set(0, 0.62, 0);
  nameSprite.scale.set(1.85, 0.46, 1);
  headGroup.add(nameSprite);

  return {
    root,
    bodyGroup,
    torsoMesh,
    jerseyTrimMesh,
    jerseyBackMat,
    leftArmPivot,
    rightArmPivot,
    leftLegPivot,
    rightLegPivot,
    headGroup,
    faceDiscMat,
    faceRimMat,
    helmetOrCapGroup,
    helmetMat,
    batPivot,
    handBallMesh,
    nameSpriteMat,
    lastKey: '',
  };
}

function syncCricketerAppearance(
  rig: CricketerRig,
  player: CricketerVisual,
  franchise: Franchise
) {
  const key = `${player.id}|${player.jerseyNumber}|${player.battingHand}|${franchise.id}`;
  if (rig.lastKey === key) return;
  rig.lastKey = key;

  (rig.torsoMesh.material as THREE.MeshStandardMaterial).color.set(franchise.primaryColor);
  (rig.jerseyTrimMesh.material as THREE.MeshStandardMaterial).color.set(franchise.secondaryColor);
  rig.helmetMat.color.set(franchise.primaryColor);
  rig.faceRimMat.color.set(franchise.secondaryColor);

  const faceTex = getOrBuildPlayerFaceTexture(
    player,
    franchise.primaryColor,
    franchise.secondaryColor
  );
  rig.faceDiscMat.map = faceTex;
  rig.faceDiscMat.needsUpdate = true;

  const jerseyTex = getOrBuildJerseyTexture(
    player,
    franchise.primaryColor,
    franchise.secondaryColor,
    franchise.textOnPrimary
  );
  rig.jerseyBackMat.map = jerseyTex;
  rig.jerseyBackMat.needsUpdate = true;

  const nameTex = getOrBuildNameTexture(
    player,
    franchise.primaryColor,
    franchise.secondaryColor
  );
  rig.nameSpriteMat.map = nameTex;
  rig.nameSpriteMat.needsUpdate = true;
}

export interface Cricket3DController {
  updateState: (state: LiveSceneState) => void;
  dispose: () => void;
}

function detectSoftwareWebGL(canvas: HTMLCanvasElement): boolean {
  try {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererStr = dbg
      ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(rendererStr);
  } catch {
    return false;
  }
}

export function mountCricketStadium3D(
  container: HTMLElement,
  initialState: LiveSceneState
): Cricket3DController {
  let latestState = initialState;

  const probeCanvas = document.createElement('canvas');
  const isSoftwareGl = detectSoftwareWebGL(probeCanvas);

  const renderer = new THREE.WebGLRenderer({
    antialias: !isSoftwareGl,
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const initW = Math.max(container.clientWidth || 800, 320);
  const initH = Math.max(container.clientHeight || 420, 240);
  renderer.setSize(initW, initH);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#091326');
  scene.fog = new THREE.FogExp2('#091326', 0.006);

  const camera = new THREE.PerspectiveCamera(44, initW / initH, 0.3, 180);
  camera.position.set(4.0, 4.2, -15.6);
  camera.lookAt(_currentLookAt);

  // Environment IBL via RoomEnvironment
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.85;
  pmrem.dispose();

  // Warm / Cool Floodlit Stadium Lighting
  const hemiLight = new THREE.HemisphereLight('#93C5FD', '#1A3A28', 0.85);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight('#FFF5DB', 2.35);
  keyLight.position.set(16, 32, -14);
  if (!isSoftwareGl) {
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 90;
    keyLight.shadow.camera.left = -26;
    keyLight.shadow.camera.right = 26;
    keyLight.shadow.camera.top = 26;
    keyLight.shadow.camera.bottom = -26;
    keyLight.shadow.bias = -0.0005;
  }
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight('#60A5FA', 0.85);
  rimLight.position.set(-20, 15, 22);
  scene.add(rimLight);

  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // Tracked disposables for full teardown
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };
  const trackTex = <T extends THREE.Texture>(t: T): T => {
    textures.push(t);
    return t;
  };

  // 1. Outfield Turf
  const grassTex = trackTex(buildGrassTexture(maxAniso));
  const outfieldGeo = trackGeo(new THREE.CircleGeometry(33, 64));
  const outfieldMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: grassTex,
      roughness: 0.88,
      metalness: 0.02,
    })
  );
  const outfieldMesh = new THREE.Mesh(outfieldGeo, outfieldMat);
  outfieldMesh.rotation.x = -Math.PI / 2;
  outfieldMesh.receiveShadow = !isSoftwareGl;
  scene.add(outfieldMesh);

  // Outer Stadium Skirt
  const outerSkirt = new THREE.Mesh(
    trackGeo(new THREE.RingGeometry(33, 52, 64)),
    trackMat(new THREE.MeshStandardMaterial({ color: '#0F172A', roughness: 0.92 }))
  );
  outerSkirt.rotation.x = -Math.PI / 2;
  outerSkirt.position.y = -0.02;
  scene.add(outerSkirt);

  // 2. 22-Yard Pitch Strip
  const pitchTex = trackTex(buildPitchTexture(maxAniso));
  const pitchMesh = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(3.2, 21.8)),
    trackMat(
      new THREE.MeshStandardMaterial({
        map: pitchTex,
        roughness: 0.92,
        metalness: 0.02,
      })
    )
  );
  pitchMesh.rotation.x = -Math.PI / 2;
  pitchMesh.position.y = 0.015;
  pitchMesh.receiveShadow = !isSoftwareGl;
  scene.add(pitchMesh);

  // 3. 30-Yard Inner Circle & White Boundary Rope
  const innerCircle = new THREE.Mesh(
    trackGeo(new THREE.RingGeometry(15.2, 15.36, 64)),
    trackMat(
      new THREE.MeshBasicMaterial({
        color: '#E2E8F0',
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
      })
    )
  );
  innerCircle.rotation.x = -Math.PI / 2;
  innerCircle.position.y = 0.022;
  scene.add(innerCircle);

  const boundaryRope = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(27.5, 0.14, 10, 96)),
    trackMat(new THREE.MeshStandardMaterial({ color: '#F8FAFC', roughness: 0.45 }))
  );
  boundaryRope.rotation.x = Math.PI / 2;
  boundaryRope.position.y = 0.14;
  scene.add(boundaryRope);

  // 4. Perimeter LED Boards
  let currentLedBannerKey = `${initialState.battingFranchise.id}|${initialState.bowlingFranchise.id}`;
  let ledTex = buildPerimeterLedTexture(
    initialState.battingFranchise.shortName,
    initialState.bowlingFranchise.shortName,
    initialState.battingFranchise.primaryColor,
    initialState.bowlingFranchise.primaryColor
  );
  const ledMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: ledTex,
      roughness: 0.4,
      emissive: '#FFFFFF',
      emissiveMap: ledTex,
      emissiveIntensity: 0.35,
      side: THREE.BackSide,
    })
  );
  const ledWall = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(29.8, 29.8, 1.35, 64, 1, true)),
    ledMat
  );
  ledWall.position.y = 0.68;
  scene.add(ledWall);

  // 5. Tiered Stadium Bowl & Floodlight Towers
  const lowerTier = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(37.5, 30.8, 6.2, 64, 1, true)),
    trackMat(
      new THREE.MeshStandardMaterial({
        color: '#131F36',
        roughness: 0.85,
        side: THREE.BackSide,
      })
    )
  );
  lowerTier.position.y = 3.1;
  scene.add(lowerTier);

  const upperTier = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(44.5, 38.0, 5.4, 64, 1, true)),
    trackMat(
      new THREE.MeshStandardMaterial({
        color: '#0D172B',
        roughness: 0.88,
        side: THREE.BackSide,
      })
    )
  );
  upperTier.position.y = 8.9;
  scene.add(upperTier);

  // Stadium Roof Rim
  const roofRing = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(44.8, 0.75, 10, 64)),
    trackMat(new THREE.MeshStandardMaterial({ color: '#1E293B', roughness: 0.55, metalness: 0.45 }))
  );
  roofRing.rotation.x = Math.PI / 2;
  roofRing.position.y = 11.7;
  scene.add(roofRing);

  // Crowd InstancedMesh around lower tier
  const crowdCount = 420;
  const crowdGeo = trackGeo(new THREE.BoxGeometry(0.45, 0.65, 0.45));
  const crowdMat = trackMat(new THREE.MeshStandardMaterial({ roughness: 0.75 }));
  const crowdInstanced = new THREE.InstancedMesh(crowdGeo, crowdMat, crowdCount);
  const dummy = new THREE.Object3D();
  const cColor = new THREE.Color();
  for (let i = 0; i < crowdCount; i++) {
    const ring = i % 3;
    const ang = (i / crowdCount) * Math.PI * 2 + ring * 0.09;
    const rad = 32.0 + ring * 2.1;
    const y = 1.6 + ring * 1.5;
    dummy.position.set(Math.cos(ang) * rad, y, Math.sin(ang) * rad);
    dummy.rotation.set(0, -ang + Math.PI / 2, 0);
    dummy.updateMatrix();
    crowdInstanced.setMatrixAt(i, dummy.matrix);
    if (i % 5 === 0) cColor.set(initialState.battingFranchise.secondaryColor);
    else if (i % 4 === 0) cColor.set('#38BDF8');
    else if (i % 3 === 0) cColor.set(initialState.bowlingFranchise.primaryColor);
    else cColor.set('#CBD5E1');
    crowdInstanced.setColorAt(i, cColor);
  }
  crowdInstanced.instanceMatrix.needsUpdate = true;
  if (crowdInstanced.instanceColor) crowdInstanced.instanceColor.needsUpdate = true;
  scene.add(crowdInstanced);

  // 4 Floodlight Towers
  const towerMat = trackMat(new THREE.MeshStandardMaterial({ color: '#334155', metalness: 0.6, roughness: 0.4 }));
  const bulbMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#FEF9C3',
      emissive: '#FEF08A',
      emissiveIntensity: 1.8,
      roughness: 0.25,
    })
  );
  const towerAngles = [Math.PI * 0.23, Math.PI * 0.77, Math.PI * 1.23, Math.PI * 1.77];
  towerAngles.forEach((ang) => {
    const tx = Math.cos(ang) * 43;
    const tz = Math.sin(ang) * 43;
    const pylon = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.45, 0.75, 23, 8)), towerMat);
    pylon.position.set(tx, 11.5, tz);
    scene.add(pylon);

    const head = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(5.2, 2.3, 0.5)), bulbMat);
    head.position.set(tx, 23.0, tz);
    head.lookAt(0, 0, 0);
    scene.add(head);
  });

  // 6. Stumps & Bails (Bowling end z = -9.6, Batting end z = +9.6)
  const stumpMat = trackMat(new THREE.MeshStandardMaterial({ color: '#FDE68A', roughness: 0.42 }));
  const bailMat = trackMat(new THREE.MeshStandardMaterial({ color: '#F59E0B', roughness: 0.42 }));
  const stumpGeo = trackGeo(new THREE.CylinderGeometry(0.025, 0.028, 0.76, 10));
  const bailGeo = trackGeo(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 8));

  const bowlingStumps = new THREE.Group();
  bowlingStumps.position.set(0, 0, -9.6);
  [-0.14, 0, 0.14].forEach((sx) => {
    const st = new THREE.Mesh(stumpGeo, stumpMat);
    st.position.set(sx, 0.38, 0);
    bowlingStumps.add(st);
  });
  scene.add(bowlingStumps);

  const battingStumpMeshes: THREE.Mesh[] = [];
  const battingBailMeshes: THREE.Mesh[] = [];
  const battingStumpsGroup = new THREE.Group();
  battingStumpsGroup.position.set(0, 0, 9.6);
  [-0.14, 0, 0.14].forEach((sx) => {
    const st = new THREE.Mesh(stumpGeo, stumpMat);
    st.position.set(sx, 0.38, 0);
    st.castShadow = !isSoftwareGl;
    battingStumpMeshes.push(st);
    battingStumpsGroup.add(st);
  });
  [-0.07, 0.07].forEach((bx) => {
    const bl = new THREE.Mesh(bailGeo, bailMat);
    bl.rotation.z = Math.PI / 2;
    bl.position.set(bx, 0.78, 0);
    battingBailMeshes.push(bl);
    battingStumpsGroup.add(bl);
  });
  scene.add(battingStumpsGroup);

  // 7. Aiming & Bounce Target Reticle on Pitch/Outfield
  const aimGroup = new THREE.Group();
  const aimPoints = [new THREE.Vector3(0, 0.05, 8.6), new THREE.Vector3(0, 0.05, -2.5)];
  const aimLineGeo = trackGeo(new THREE.BufferGeometry().setFromPoints(aimPoints));
  const aimLineMat = trackMat(
    new THREE.LineDashedMaterial({
      color: '#FBBF24',
      dashSize: 0.6,
      gapSize: 0.4,
      transparent: true,
      opacity: 0.75,
    })
  );
  const aimLine = new THREE.Line(aimLineGeo, aimLineMat);
  aimLine.computeLineDistances();
  const aimMarker = new THREE.Mesh(
    trackGeo(new THREE.RingGeometry(0.32, 0.48, 24)),
    trackMat(new THREE.MeshBasicMaterial({ color: '#FBBF24', side: THREE.DoubleSide }))
  );
  aimMarker.rotation.x = -Math.PI / 2;
  aimMarker.position.y = 0.05;
  aimGroup.add(aimLine, aimMarker);
  scene.add(aimGroup);

  // 8. Articulated Batter & Bowler Rigs
  const batterRig = createCricketerRig(true, !isSoftwareGl);
  batterRig.root.position.set(0, 0, 8.75);
  batterRig.root.rotation.y = Math.PI; // Facing -Z (toward bowler & TV cam!)
  syncCricketerAppearance(batterRig, initialState.batter, initialState.battingFranchise);
  scene.add(batterRig.root);

  const bowlerRig = createCricketerRig(false, !isSoftwareGl);
  bowlerRig.root.position.set(-0.32, 0, -14.2);
  bowlerRig.root.rotation.y = 0; // Facing +Z (toward batter)
  syncCricketerAppearance(bowlerRig, initialState.bowler, initialState.bowlingFranchise);
  scene.add(bowlerRig.root);

  // 9. 9 Dynamic Fielders (5-part mini-rigs)
  const fielderSpots: Array<[number, number]> = [
    [-11.5, 4.5],
    [11.5, 4.5],
    [-14.5, -4.5],
    [14.5, -4.5],
    [-9.5, -13.5],
    [9.5, -13.5],
    [-19.5, 11.5],
    [19.5, 11.5],
    [0, -23.0],
  ];
  const fielderGroups: THREE.Group[] = [];
  const fielderJerseyMat = trackMat(
    new THREE.MeshStandardMaterial({ color: initialState.bowlingFranchise.primaryColor, roughness: 0.6 })
  );
  const fielderCapMat = trackMat(
    new THREE.MeshStandardMaterial({ color: initialState.bowlingFranchise.secondaryColor, roughness: 0.45 })
  );
  const fielderSkinMat = trackMat(new THREE.MeshStandardMaterial({ color: '#C68642', roughness: 0.65 }));

  fielderSpots.forEach(([fx, fz]) => {
    const fg = new THREE.Group();
    fg.position.set(fx, 0, fz);
    fg.lookAt(0, 0, 8.6);

    const fShadow = new THREE.Mesh(
      trackGeo(new THREE.CircleGeometry(0.45, 16)),
      trackMat(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }))
    );
    fShadow.rotation.x = -Math.PI / 2;
    fShadow.position.y = 0.02;

    const fLegs = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.18, 0.14, 0.85, 10)), fielderJerseyMat);
    fLegs.position.y = 0.425;
    const fTorso = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.24, 0.2, 0.56, 12)), fielderJerseyMat);
    fTorso.position.y = 1.13;
    const fHead = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.19, 12, 12)), fielderSkinMat);
    fHead.position.y = 1.58;
    const fCap = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.2, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.45)),
      fielderCapMat
    );
    fCap.position.y = 1.62;

    fg.add(fShadow, fLegs, fTorso, fHead, fCap);
    fielderGroups.push(fg);
    scene.add(fg);
  });

  // 10. Animated 3D Cricket Ball + Ground Shadow + Boundary Trail Ribbon
  const ballGroup = new THREE.Group();
  const ballMesh = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(0.125, 18, 18)),
    trackMat(new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.28, metalness: 0.1 }))
  );
  const seamMesh = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.126, 0.014, 8, 24)),
    trackMat(new THREE.MeshStandardMaterial({ color: '#DC2626', roughness: 0.45 }))
  );
  ballMesh.add(seamMesh);
  ballMesh.castShadow = !isSoftwareGl;

  const ballShadow = new THREE.Mesh(
    trackGeo(new THREE.CircleGeometry(0.18, 16)),
    trackMat(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }))
  );
  ballShadow.rotation.x = -Math.PI / 2;
  ballShadow.position.y = 0.03;

  ballGroup.add(ballMesh);
  ballGroup.visible = false;
  ballShadow.visible = false;
  scene.add(ballGroup, ballShadow);

  // Boundary Trajectory Trail (Line)
  const MAX_TRAIL_PTS = 28;
  const trailPositions = new Float32Array(MAX_TRAIL_PTS * 3);
  const trailGeo = trackGeo(new THREE.BufferGeometry());
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  trailGeo.setDrawRange(0, 0);
  const trailMat = trackMat(
    new THREE.LineBasicMaterial({ color: '#FBBF24', transparent: true, opacity: 0.9 })
  );
  const trailLine = new THREE.Line(trailGeo, trailMat);
  trailLine.visible = false;
  scene.add(trailLine);

  // ResizeObserver
  const handleResize = () => {
    const w = Math.max(container.clientWidth || 800, 320);
    const h = Math.max(container.clientHeight || 420, 240);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(container);

  // Context loss recovery
  let disposed = false;
  const onContextLost = (e: Event) => {
    e.preventDefault();
  };
  renderer.domElement.addEventListener('webglcontextlost', onContextLost, false);

  // Frame pacing helpers
  let rafId = 0;
  let timerId = 0;
  let prevNow = performance.now();

  const renderTick = (now: number) => {
    if (disposed) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - prevNow) / 1000));
    prevNow = now;
    const st = latestState;

    // Sync batter & bowler appearances (textures + colors + real auctioned faces)
    syncCricketerAppearance(batterRig, st.batter, st.battingFranchise);
    syncCricketerAppearance(bowlerRig, st.bowler, st.bowlingFranchise);

    // Sync fielder colors & LED banner when innings flips
    fielderJerseyMat.color.set(st.bowlingFranchise.primaryColor);
    fielderCapMat.color.set(st.bowlingFranchise.secondaryColor);
    const nextBannerKey = `${st.battingFranchise.id}|${st.bowlingFranchise.id}`;
    if (nextBannerKey !== currentLedBannerKey) {
      currentLedBannerKey = nextBannerKey;
      const oldTex = ledTex;
      ledTex = buildPerimeterLedTexture(
        st.battingFranchise.shortName,
        st.bowlingFranchise.shortName,
        st.battingFranchise.primaryColor,
        st.bowlingFranchise.primaryColor
      );
      ledMat.map = ledTex;
      ledMat.emissiveMap = ledTex;
      ledMat.needsUpdate = true;
      oldTex.dispose();
    }

    // Left-handed vs Right-handed batter stance positioning
    const isLhb = st.batter.battingHand === 'LHB';
    const stanceSign = isLhb ? -1 : 1;
    batterRig.root.position.set(stanceSign * 0.42, 0, 8.75);
    batterRig.root.rotation.y = Math.PI; // Faces -Z toward bowler

    // Aim / Bounce guide
    if (st.stage === 'IDLE') {
      aimGroup.visible = true;
      if (st.isUserBatting) {
        const dirAng = st.direction === 'OFF' ? -0.58 * stanceSign : st.direction === 'LEG' ? 0.58 * stanceSign : 0;
        const posAttr = aimLineGeo.getAttribute('position') as THREE.BufferAttribute;
        const endX = Math.sin(dirAng) * 14.5;
        const endZ = 8.6 - Math.cos(dirAng) * 14.5;
        posAttr.setXYZ(0, 0, 0.05, 8.6);
        posAttr.setXYZ(1, endX, 0.05, endZ);
        posAttr.needsUpdate = true;
        aimLine.computeLineDistances();
        aimMarker.position.set(endX, 0.05, endZ);
        (aimLineMat as THREE.LineDashedMaterial).color.set('#FBBF24');
        (aimMarker.material as THREE.MeshBasicMaterial).color.set('#FBBF24');
      } else {
        const bounceZ =
          st.selectedDelivery === 'YORKER'
            ? 8.2
            : st.selectedDelivery === 'BOUNCER'
            ? 2.2
            : st.selectedDelivery === 'SLOWER'
            ? 5.6
            : 4.8;
        const bounceX = st.direction === 'OFF' ? -0.45 : st.direction === 'LEG' ? 0.45 : 0;
        const posAttr = aimLineGeo.getAttribute('position') as THREE.BufferAttribute;
        posAttr.setXYZ(0, -0.32, 0.05, -9.2);
        posAttr.setXYZ(1, bounceX, 0.05, bounceZ);
        posAttr.needsUpdate = true;
        aimLine.computeLineDistances();
        aimMarker.position.set(bounceX, 0.05, bounceZ);
        (aimLineMat as THREE.LineDashedMaterial).color.set('#38BDF8');
        (aimMarker.material as THREE.MeshBasicMaterial).color.set('#38BDF8');
      }
    } else {
      aimGroup.visible = false;
    }

    // Reset batting stumps unless Wicket flight
    const isWicketFlight = st.stage === 'FLIGHT' && st.flight.outcome === 'W';
    if (!isWicketFlight) {
      battingStumpMeshes.forEach((m, i) => {
        m.position.set((i - 1) * 0.14, 0.38, 0);
        m.rotation.set(0, 0, 0);
      });
      battingBailMeshes.forEach((b, i) => {
        b.position.set(i === 0 ? -0.07 : 0.07, 0.78, 0);
        b.rotation.set(0, 0, Math.PI / 2);
      });
    }

    // Animate Bowler, Batter, Stumps, Ball & Fielders
    const idlePulse = Math.sin(now * 0.004);
    const runStartZ = -14.8;
    const creaseZ = -9.4;

    if (st.stage === 'IDLE') {
      bowlerRig.root.position.set(-0.32, 0, runStartZ);
      bowlerRig.root.rotation.y = st.cameraPreset === 'BOTH_FACES' ? 0.35 : 0;
      bowlerRig.leftLegPivot.rotation.x = 0;
      bowlerRig.rightLegPivot.rotation.x = 0;
      bowlerRig.leftArmPivot.rotation.x = 0.15;
      bowlerRig.rightArmPivot.rotation.x = -0.25 + idlePulse * 0.06;
      bowlerRig.handBallMesh.visible = true;

      batterRig.bodyGroup.position.y = Math.abs(idlePulse) * 0.025;
      batterRig.rightArmPivot.rotation.set(-0.55, 0, -0.18 * stanceSign);
      batterRig.leftArmPivot.rotation.set(-0.62, 0, 0.2 * stanceSign);
      batterRig.batPivot.rotation.set(0.35, 0, -0.2 * stanceSign);

      ballGroup.visible = false;
      ballShadow.visible = false;
      trailLine.visible = false;
    } else if (st.stage === 'RUNUP') {
      const t = Math.min(1, st.stageElapsed / Math.max(1, st.runupDur));
      const stride = t * 18;
      bowlerRig.root.position.set(-0.32, Math.abs(Math.sin(stride)) * 0.14, runStartZ + (creaseZ - runStartZ) * t);
      bowlerRig.root.rotation.y = 0;
      bowlerRig.leftLegPivot.rotation.x = Math.sin(stride) * 0.72;
      bowlerRig.rightLegPivot.rotation.x = -Math.sin(stride) * 0.72;
      bowlerRig.leftArmPivot.rotation.x = -Math.sin(stride) * 0.65;
      bowlerRig.rightArmPivot.rotation.x = Math.sin(stride) * 0.65;
      bowlerRig.handBallMesh.visible = true;

      // Batter crouches slightly ready
      batterRig.bodyGroup.position.y = -0.05;
      batterRig.rightArmPivot.rotation.set(-0.7, 0, -0.2 * stanceSign);
      batterRig.batPivot.rotation.set(0.45, 0, -0.18 * stanceSign);

      ballGroup.visible = false;
      ballShadow.visible = false;
      trailLine.visible = false;
    } else if (st.stage === 'DELIVERY') {
      const t = Math.min(1, st.stageElapsed / Math.max(1, st.deliveryDur));
      bowlerRig.root.position.set(-0.32, 0, creaseZ + t * 0.8);
      bowlerRig.root.rotation.y = 0;
      bowlerRig.leftLegPivot.rotation.x = 0.35;
      bowlerRig.rightLegPivot.rotation.x = -0.35;

      // Over-arm bowling whip first 25% of delivery stage
      if (t < 0.28) {
        const wt = t / 0.28;
        bowlerRig.rightArmPivot.rotation.x = -Math.PI * 1.15 - wt * Math.PI * 1.1;
        bowlerRig.handBallMesh.visible = true;
        ballGroup.visible = false;
        ballShadow.visible = false;
      } else {
        bowlerRig.rightArmPivot.rotation.x = 0.5;
        bowlerRig.handBallMesh.visible = false;

        const bt = (t - 0.28) / 0.72;
        const bouncePhase =
          st.selectedDelivery === 'BOUNCER'
            ? 0.42
            : st.selectedDelivery === 'YORKER'
            ? 0.86
            : 0.64;
        const swingX = st.selectedDelivery === 'SPIN' ? Math.sin(bt * Math.PI) * 0.55 : 0;
        const targetX = st.direction === 'OFF' ? -0.24 : st.direction === 'LEG' ? 0.24 : 0;
        const bx = -0.3 + (targetX - -0.3) * bt + swingX;
        const bz = creaseZ + (8.6 - creaseZ) * bt;
        const releaseH = 2.05;
        const by =
          bt < bouncePhase
            ? releaseH * (1 - bt / bouncePhase) + 0.14
            : Math.sin(((bt - bouncePhase) / (1 - bouncePhase)) * Math.PI) *
                (st.selectedDelivery === 'BOUNCER' ? 1.45 : 0.72) +
              0.14;

        ballGroup.visible = true;
        ballGroup.position.set(bx, by, bz);
        ballMesh.rotation.x += dt * 26;
        ballShadow.visible = true;
        ballShadow.position.set(bx, 0.03, bz);
      }

      // Batter backlift & forward swing near impact
      if (t > 0.74) {
        const stSwing = (t - 0.74) / 0.26;
        batterRig.rightArmPivot.rotation.set(-0.7 + stSwing * 1.45, 0, -0.2 * stanceSign);
        batterRig.batPivot.rotation.set(0.45 - stSwing * 1.1, 0, 0);
      }
      trailLine.visible = false;
    } else if (st.stage === 'FLIGHT') {
      const t = Math.min(1, st.stageElapsed / Math.max(1, st.flightDur));
      const out = st.flight.outcome;
      const dirSign = st.flight.direction === 'OFF' ? -1 : st.flight.direction === 'LEG' ? 1 : 0;

      // Follow-through bat swing
      const followT = Math.min(1, st.stageElapsed / 240);
      batterRig.rightArmPivot.rotation.set(0.75 + followT * 0.4, dirSign * 0.5 * followT, -0.25 * stanceSign);
      batterRig.leftArmPivot.rotation.set(0.55 + followT * 0.35, dirSign * 0.4 * followT, 0.2 * stanceSign);
      batterRig.batPivot.rotation.set(-0.7 - followT * 0.45, 0, dirSign * 0.35 * followT);

      if (out === 'W') {
        ballGroup.visible = false;
        ballShadow.visible = false;
        trailLine.visible = false;

        // Scatter & spin batting stumps + bails!
        const wt = Math.min(1, st.stageElapsed / 480);
        battingStumpMeshes.forEach((m, i) => {
          const spread = i - 1;
          m.position.set(
            spread * 0.14 + spread * 0.85 * wt,
            0.38 + Math.sin(wt * Math.PI) * 0.9 - wt * 0.22,
            1.45 * wt
          );
          m.rotation.set(wt * (1.5 + i * 0.4), wt * spread * 2.2, wt * spread * 1.9);
        });
        battingBailMeshes.forEach((b, i) => {
          const s = i === 0 ? -1 : 1;
          b.position.set(s * 0.9 * wt, 0.78 + Math.sin(wt * Math.PI) * 1.65 - wt * 0.6, 1.8 * wt);
          b.rotation.set(wt * 5, wt * 4, wt * 6);
        });
      } else {
        const sx = 0;
        const sy = 0.72;
        const sz = 8.5;
        const tx =
          out === '6'
            ? dirSign * 22.0 + (dirSign === 0 ? 1.5 : 0)
            : out === '4'
            ? dirSign * 20.5 + (dirSign === 0 ? 1.2 : 0)
            : out === '2'
            ? dirSign * 12.0
            : out === '1'
            ? dirSign * 8.5
            : 0.8;
        const tz =
          out === '6'
            ? -24.0
            : out === '4'
            ? -21.5
            : out === '2'
            ? -6.5
            : out === '1'
            ? -2.0
            : 4.5;

        const easeOut = 1 - Math.pow(1 - t, 2);
        const bx = sx + (tx - sx) * easeOut;
        const bz = sz + (tz - sz) * easeOut;
        const peakH = out === '6' ? 9.5 : out === '4' ? 1.2 : out === '0' ? 0.35 : 0.85;
        const by = 0.14 + sy * (1 - easeOut) + Math.sin(t * Math.PI) * peakH;

        ballGroup.visible = true;
        ballGroup.position.set(bx, by, bz);
        ballMesh.rotation.x += dt * 20;
        ballMesh.rotation.y += dt * 14;
        ballShadow.visible = true;
        ballShadow.position.set(bx, 0.03, bz);

        // Update boundary trail
        if (out === '6' || out === '4') {
          trailLine.visible = true;
          (trailMat as THREE.LineBasicMaterial).color.set(out === '6' ? '#FBBF24' : '#34D399');
          const steps = MAX_TRAIL_PTS;
          const posAttr = trailGeo.getAttribute('position') as THREE.BufferAttribute;
          for (let i = 0; i < steps; i++) {
            const ptT = (i / (steps - 1)) * t;
            const pe = 1 - Math.pow(1 - ptT, 2);
            const px = sx + (tx - sx) * pe;
            const pz = sz + (tz - sz) * pe;
            const py = 0.14 + sy * (1 - pe) + Math.sin(ptT * Math.PI) * peakH;
            posAttr.setXYZ(i, px, py, pz);
          }
          posAttr.needsUpdate = true;
          trailGeo.setDrawRange(0, steps);
        } else {
          trailLine.visible = false;
        }
      }
    }

    // Animate fielders subtly chasing ball in FLIGHT
    fielderGroups.forEach((fg, idx) => {
      const [baseX, baseZ] = fielderSpots[idx];
      if (st.stage === 'FLIGHT' && st.flight.outcome !== 'W' && st.flight.outcome !== '0') {
        _tempVecA.set(ballGroup.position.x, 0, ballGroup.position.z);
        _tempVecB.set(baseX, 0, baseZ);
        const dist = _tempVecA.distanceTo(_tempVecB);
        if (dist < 18) {
          const chase = Math.min(1, st.stageElapsed / Math.max(1, st.flightDur)) * 0.25;
          fg.position.x = baseX + (_tempVecA.x - baseX) * chase;
          fg.position.z = baseZ + (_tempVecA.z - baseZ) * chase;
          fg.lookAt(_tempVecA.x, 0, _tempVecA.z);
        }
      } else {
        fg.position.set(baseX, Math.abs(Math.sin(now * 0.003 + idx)) * 0.03, baseZ);
        fg.lookAt(0, 0, 8.6);
      }
    });

    // Smooth Damped Broadcast / Action Camera
    if (st.cameraPreset === 'BOTH_FACES') {
      batterRig.headGroup.rotation.y = THREE.MathUtils.damp(batterRig.headGroup.rotation.y, -0.35, 6, dt);
      bowlerRig.headGroup.rotation.y = THREE.MathUtils.damp(bowlerRig.headGroup.rotation.y, 0.35, 6, dt);
    } else {
      batterRig.headGroup.rotation.y = THREE.MathUtils.damp(batterRig.headGroup.rotation.y, 0, 6, dt);
      bowlerRig.headGroup.rotation.y = THREE.MathUtils.damp(bowlerRig.headGroup.rotation.y, 0, 6, dt);
    }

    if (st.cameraPreset === 'BOWLER') {
      if (st.stage === 'IDLE' || st.stage === 'RUNUP') {
        _camTargetPos.set(2.1, 2.35, -3.5);
        _camLookAtPos.set(bowlerRig.root.position.x, 1.45, bowlerRig.root.position.z);
      } else {
        _camTargetPos.set(3.4, 3.8, -14.8);
        _camLookAtPos.set(0, 1.35, 8.2);
      }
    } else if (st.cameraPreset === 'BOTH_FACES') {
      // Elevated 3/4 view across pitch showing BOTH bowler's & batter's 3D faces!
      _camTargetPos.set(12.2, 4.1, -0.5);
      _camLookAtPos.set(0, 1.3, 0.5);
    } else {
      // Classic IPL TV Broadcast behind bowler, framing batter's face cleanly
      if (st.stage === 'FLIGHT' && (st.flight.outcome === '6' || st.flight.outcome === '4')) {
        _camTargetPos.set(
          4.4 + ballGroup.position.x * 0.14,
          5.1,
          -15.4
        );
        _camLookAtPos.set(ballGroup.position.x * 0.35, 1.6, 2.0);
      } else {
        _camTargetPos.set(3.8, 4.0, -15.4);
        _camLookAtPos.set(0, 1.35, 5.2);
      }
    }

    camera.position.x = THREE.MathUtils.damp(camera.position.x, _camTargetPos.x, 6, dt);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, _camTargetPos.y, 6, dt);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, _camTargetPos.z, 6, dt);

    _currentLookAt.x = THREE.MathUtils.damp(_currentLookAt.x, _camLookAtPos.x, 7, dt);
    _currentLookAt.y = THREE.MathUtils.damp(_currentLookAt.y, _camLookAtPos.y, 7, dt);
    _currentLookAt.z = THREE.MathUtils.damp(_currentLookAt.z, _camLookAtPos.z, 7, dt);
    camera.lookAt(_currentLookAt);

    renderer.render(scene, camera);
  };

  // Frame loop: fenceSync pacing when running under software WebGL (SwiftShader/llvmpipe), standard RAF on GPU
  const scheduleNextFrame = () => {
    if (disposed) return;
    if (isSoftwareGl) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          if (disposed) {
            if (sync) gl.deleteSync(sync);
            return;
          }
          if (!sync || gl.clientWaitSync(sync, 0, 0) !== gl.TIMEOUT_EXPIRED) {
            if (sync) gl.deleteSync(sync);
            rafId = requestAnimationFrame((now) => {
              renderTick(now);
              scheduleNextFrame();
            });
          } else {
            timerId = window.setTimeout(poll, 8);
          }
        };
        timerId = window.setTimeout(poll, 8);
        return;
      }
    }
    rafId = requestAnimationFrame((now) => {
      renderTick(now);
      scheduleNextFrame();
    });
  };

  renderTick(performance.now());
  scheduleNextFrame();

  return {
    updateState: (next) => {
      latestState = next;
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      clearTimeout(timerId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);

      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Sprite) {
          if ('geometry' in obj && obj.geometry) {
            obj.geometry.dispose();
          }
          const mat = obj.material;
          if (Array.isArray(mat)) {
            mat.forEach((m) => m.dispose());
          } else if (mat) {
            mat.dispose();
          }
        }
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      ledTex.dispose();
      envTex.dispose();
      renderer.dispose();

      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}
