/**
 * Exercise data for a fresh server start, generated per branch on that branch's geography: units, escort plans,
 * incidents, pending detections, field devices (with coverage) and open alerts. Everything here is synthetic
 * training data and is labelled as such in the console; only the base map (roads, facilities) may be real.
 */
import { alongPolyline, bearingDeg, distanceM, offset, type LatLon } from './geo';
import type { BranchDef } from './geodata/branches';
import type { BranchGeo, Poi } from './geodata/types';
import { L, localDigits } from './i18n/messages';
import { tri, type Tri } from './i18n/types';
import { edgeSeconds, type RoadGraph } from './routing/graph';
import type { UnitMeta } from './domain/units';
import { planTitle, type EscortPlan, type Place } from './domain/plans';
import type { Device } from './domain/devices';
import type { Detection } from './domain/detections';
import type { NewAlert } from './domain/alerts';
import type { RiskModel } from './domain/risk';

/** Branch staff referenced by seeded records (usernames from the user directory). */
export const STAFF: Record<string, { commander: string; planner: string }> = {
  MZR: { commander: 'ahmadi', planner: 'ali' },
  KBL: { commander: 'karimi', planner: 'ali' },
  HRT: { commander: 'sultani', planner: 'sultani' },
};

const num = (s: string | number): Tri => ({ dr: localDigits('dr', s).replace(/%/g, '٪'), ps: localDigits('ps', s).replace(/%/g, '٪'), en: String(s) });
const BRAVO = tri('براوو', 'براوو', 'Bravo');

export interface KeySites { hq: Poi; safeHouses: Poi[]; hospital: Poi; destination: Poi; government: Poi; far: Poi }

export function keySites(geo: BranchGeo): KeySites {
  const of = (k: Poi['kind']) => geo.pois.filter((p) => p.kind === k);
  const hq = of('hq')[0];
  const hospital = [...of('hospital'), ...of('clinic')].sort((a, b) => distanceM(hq, a) - distanceM(hq, b))[0] ?? hq;
  const government = of('government')[0] ?? hq;
  const far = [...of('police'), ...of('hospital'), ...of('fuel')].sort((a, b) => distanceM(hq, b) - distanceM(hq, a))[0] ?? government;
  const destination = of('airport')[0] ?? far;
  return { hq, safeHouses: of('safe_house'), hospital, destination, government, far };
}

const place = (p: Poi): Place => ({ name: p.name, lat: p.lat, lon: p.lon });

/** Shortest-time path between two points (no risk weighting) — the "naive" route incidents are placed along. */
export function baselinePath(graph: RoadGraph, a: LatLon, b: LatLon): LatLon[] {
  const path = graph.astar(graph.nearest(a).node, graph.nearest(b).node, edgeSeconds);
  if (!path || !path.edges.length) return [a, b];
  return [graph.nodes[path.edges[0].from], ...path.edges.map((e) => graph.nodes[e.to])];
}

/** Point `frac` along a path, moved `sideM` to the right of the direction of travel. */
export function besidePath(path: LatLon[], frac: number, sideM = 0): LatLon {
  const p = alongPolyline(path, frac);
  if (!sideM) return p;
  const q = alongPolyline(path, Math.min(1, frac + 0.01));
  const r = ((bearingDeg(p, q) + 90) * Math.PI) / 180;
  return offset(p, sideM * Math.sin(r), sideM * Math.cos(r));
}

/**
 * Incident clusters along the naive route. Corroborating reports raise likelihood in the risk engine, so the
 * ambush cluster forms a critical core with a high-risk ring, the vehicle cluster a high-risk pocket, and the
 * single reports stay medium — the spread the map and the planner need to show safe versus unsafe corridors.
 */
export function seedIncidents(risk: RiskModel, naive: LatLon[]): void {
  const add = (type: string, severity: 'low' | 'medium' | 'high' | 'critical', p: LatLon, radius_m: number, confidence: number, evidence: string[]) =>
    risk.add({ type, severity, location: { lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6) }, radius_m, confidence, evidence, source: 'seed', human_validation_status: 'confirmed' });
  const ambush = besidePath(naive, 0.5, 150);
  add('armed_threat', 'critical', ambush, 600, 0.92, ['D-01', 'yolov8']);
  add('armed_persons', 'high', offset(ambush, 120, 60), 420, 0.85, ['CAM-03']);
  add('ied_report', 'high', offset(ambush, -150, -40), 450, 0.8, ['field_report']);
  add('hostile_surveillance', 'medium', offset(ambush, 40, -160), 650, 0.7, ['humint']);
  const vehicle = besidePath(naive, 0.3, -250);
  add('suspicious_vehicle', 'high', vehicle, 400, 0.74, ['CAM-03']);
  add('checkpoint_breach', 'high', offset(vehicle, 90, 70), 340, 0.8, ['police_report']);
  add('unusual_gathering', 'medium', offset(vehicle, -80, 40), 420, 0.61, ['D-01']);
  add('unusual_gathering', 'medium', besidePath(naive, 0.72, 400), 360, 0.61, ['D-01']);
  add('roadside_object', 'medium', besidePath(naive, 0.15, 300), 260, 0.7, ['field_report']);
}

export function seedDetections(naive: LatLon[], center: LatLon): Detection[] {
  const d = (id: string, label: Tri, source: string, confidence: number, minsAgo: number, p: LatLon, severity: Detection['severity'], radius_m: number): Detection =>
    ({ id, label, source, confidence, observed_at: new Date(Date.now() - minsAgo * 60_000).toISOString(), lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), severity, radius_m, status: 'pending' });
  return [
    d('t1', tri('افراد مسلح ×۳', 'درې وسله وال کسان', '3 armed persons'), 'D-01', 0.89, 3, besidePath(naive, 0.6, 200), 'critical', 300),
    d('t2', tri('موتر مشکوک', 'شکمن موټر', 'Suspicious vehicle'), 'CAM-03', 0.74, 14, besidePath(naive, 0.2, -300), 'high', 250),
    d('t3', tri('تجمع غیرعادی', 'غیرعادي راټولېدنه', 'Unusual gathering'), 'D-01', 0.61, 37, offset(center, -900, 700), 'medium', 300),
  ];
}

export function seedUnits(def: BranchDef, sites: KeySites, geo: BranchGeo): UnitMeta[] {
  const police = geo.pois.filter((p) => p.kind === 'police').sort((a, b) => distanceM(sites.hq, b) - distanceM(sites.hq, a));
  const standby = police[0] ?? sites.government;
  const same = (s: string) => tri(s, s, s);
  return [
    { id: 'alpha', name: tri('اسکورت الفا', 'د الفا ساتونکی کاروان', 'Escort Alpha'), icon: 'car-profile', group: 'mission', sub: same('ESC-0412 · GNSS+Wi-Fi+BLE'), mission: 'ESC-0412', sources: ['gnss', 'wifi', 'ble'], comms: 'ok', start: sites.hq, alt_m: def.elevationM },
    { id: 'drone', name: tri('درون D-01', 'ډرون D-01', 'Drone D-01'), icon: 'drone', group: 'mission', sub: tri('پوشش هوایی · 4K', 'هوايي پوښښ · 4K', 'Air cover · 4K'), mission: 'ESC-0412', sources: ['gnss'], comms: 'ok', start: sites.hq, alt_m: def.elevationM + 120, device: 'D-01' },
    { id: 'bravo', name: tri('تیم براوو', 'براوو ټیم', 'Team Bravo'), icon: 'users-three', group: 'standby', sub: tri('ثابت · GNSS+BLE', 'ولاړ · GNSS+BLE', 'Stationary · GNSS+BLE'), mission: null, sources: ['gnss', 'ble'], comms: 'ok', start: offset(sites.hq, 60, -40), alt_m: def.elevationM },
    { id: 'charlie', name: tri('تیم چارلی', 'چارلي ټیم', 'Team Charlie'), icon: 'users-three', group: 'standby', sub: tri('فقط سلولی · مخابره قطع', 'یوازې سلولي · اړیکه پرې', 'Cellular only · comms lost'), mission: null, sources: ['cellular'], comms: 'lost', start: standby, alt_m: def.elevationM },
  ];
}

export function seedPlans(def: BranchDef, sites: KeySites): Array<Omit<EscortPlan, 'routes' | 'version'>> {
  const staff = STAFF[def.id] ?? STAFF.MZR;
  const sh = sites.safeHouses[1] ?? sites.safeHouses[0] ?? sites.hq;
  const o1 = place(sites.hq), d1 = place(sites.destination);
  const o2 = place(sites.destination), d2 = place(sites.government);
  const o3 = place(sh), d3 = place(sites.hq);
  return [
    { id: 'ESC-0412', title: planTitle(o1, d1), status: 'running', vip_level: 3, priority: 'security', origin: o1, destination: d1, start: num('14:05'), vehicles: 4, active_route: 'P',
      resources: [L('res.armored', { n: 2 }), L('res.team', { name: BRAVO }), L('res.drone', { id: 'D-01' }), L('res.medical', { name: sites.hospital.name })], approved_by: staff.commander },
    { id: 'ESC-0415', title: planTitle(o2, d2), status: 'pending_approval', vip_level: 4, priority: 'security', origin: o2, destination: d2, start: tri('فردا ۰۸:۳۰', 'سبا ۰۸:۳۰', 'Tomorrow 08:30'), vehicles: 4, active_route: 'A',
      resources: [L('res.armored', { n: 3 }), L('res.team', { name: BRAVO }), L('res.drone', { id: 'D-02' })], submitted_by: staff.planner },
    { id: 'ESC-0409', title: planTitle(o3, d3), status: 'closed', vip_level: 3, priority: 'balanced', origin: o3, destination: d3, start: tri('دیروز', 'پرون', 'Yesterday'), vehicles: 3, active_route: 'P',
      resources: [L('res.armored', { n: 2 }), L('res.drone', { id: 'D-01' })], approved_by: staff.commander },
  ];
}

/** Relay sites as fractions of the urban extent (east, north); the south-west sector is deliberately thin. */
const RELAY_SITES: Array<[number, number]> = [[0.08, 0.12], [0.58, 0.08], [-0.55, 0.1], [0.12, 0.62], [0.08, -0.6], [0.5, -0.52], [-0.42, 0.55]];

export function seedDevices(def: BranchDef, sites: KeySites, route: LatLon[]): Device[] {
  const now = Date.now();
  // Relay power sized so each relay reaches ~40 % of the larger urban semi-axis (log-distance model, 9 dBi mast).
  const reach = 0.4 * Math.max(def.extent.eastM, def.extent.northM);
  const txDbm = Math.round(-95 + 32 + 30 * Math.log10(reach) - 9 + 0.5);
  const hist = (): Device['history'] => [{ at: now - 90 * 60_000, message: L('dev.log.firmware') }, { at: now - 5 * 3600_000, message: L('dev.log.calibrated') }];
  const dv = (id: string, name: Tri, type: Device['type'], protocol: string, detail: Device['detail'], state: Device['state'], battery: number | null, signal: number | null, geo: LatLon | null, coverage: Device['coverage'], seenAgoMs = 0): Device =>
    ({ id, name, type, protocol, detail, state, battery_pct: battery, firmware: 'v2.4.1', signal_dbm: signal, last_seen: now - seenAgoMs, geo: geo && { lat: +geo.lat.toFixed(6), lon: +geo.lon.toFixed(6) }, coverage, history: hist() });

  const relays = RELAY_SITES.map(([fe, fn], i) => {
    const id = `REL-0${i + 1}`;
    const low = i === 4;
    return dv(id, tri(`رلهٔ ${id}`, `ریلې ${id}`, `Relay ${id}`), 'relay', 'UHF mesh', low ? tri('بتری کم · ۱۸٪', 'ټیټه بېټري · ۱۸٪', 'Low battery · 18%') : tri('مش UHF · ۱ وات', 'UHF مش · ۱ واټ', 'UHF mesh · 1 W'),
      low ? 'warn' : 'on', low ? 18 : 92 - i * 3, -48 - i, offset(def.center, fe * def.extent.eastM, fn * def.extent.northM), { kind: 'radio', tx_dbm: txDbm, gain_db: 9 });
  });

  const cams = [0.08, 0.22, 0.38, 0.64, 0.8, 0.93].map((f, i) => {
    const id = `CAM-0${i + 1}`;
    const p = alongPolyline(route, f), q = alongPolyline(route, Math.min(1, f + 0.02));
    return dv(id, tri(`کمرهٔ ${id}`, `${id} کمره`, `Camera ${id}`), 'camera', 'RTSP', tri('1080p · ۹۰°', '1080p · ۹۰°', '1080p · 90°'), 'on', null, -49 - i,
      p, { kind: 'camera', heading_deg: Math.round(bearingDeg(p, q)), fov_deg: 90, range_m: 300 });
  });
  const domes = [sites.hq, ...sites.safeHouses].map((s, i) => {
    const id = `CAM-1${i}`;
    return dv(id, tri(`کمرهٔ گنبدی ${id}`, `${id} ګنبدي کمره`, `Dome camera ${id}`), 'camera', 'RTSP', tri('4K · ۳۶۰°', '4K · ۳۶۰°', '4K · 360°'), 'on', null, -52,
      s, { kind: 'camera', heading_deg: 0, fov_deg: 360, range_m: 220 });
  });

  return [
    dv('D-01', tri('درون D-01', 'ډرون D-01', 'Drone D-01'), 'drone', 'MAVLink', tri('بتری ۶۴٪ · 4K', 'بېټري ۶۴٪ · 4K', 'Battery 64% · 4K'), 'on', 64, -58, sites.hq, { kind: 'drone', footprint_m: 350 }),
    dv('D-02', tri('درون D-02', 'ډرون D-02', 'Drone D-02'), 'drone', 'MAVLink', tri('در حال چارج', 'چارج کېږي', 'Charging'), 'idle', 97, -60, sites.hq, { kind: 'drone', footprint_m: 350 }),
    ...relays, ...cams, ...domes,
    dv('GPS-07', tri('رسیور GPS-07', 'GPS-07 رسیور', 'GPS receiver GPS-07'), 'gps', 'NMEA', num('HDOP 3.2'), 'warn', null, -71, null, null),
    dv('GPS-02', tri('رسیور GPS-02', 'GPS-02 رسیور', 'GPS receiver GPS-02'), 'gps', 'NMEA', num('HDOP 0.9'), 'on', null, -55, null, null),
    dv('IOT-12', tri('ردیاب IoT-12', 'IoT-12 تعقیبونکی', 'IoT tracker IoT-12'), 'iot', 'MQTT', tri('آخرین سگنال ۲ ساعت پیش', 'وروستی سیګنال ۲ ساعته مخکې', 'Last signal 2 h ago'), 'off', 3, null, null, null, 2 * 3600_000),
    dv('IOT-04', tri('ردیاب IoT-04', 'IoT-04 تعقیبونکی', 'IoT tracker IoT-04'), 'iot', 'MQTT', tri('بتری ۸۱٪', 'بېټري ۸۱٪', 'Battery 81%'), 'on', 81, -66, null, null),
    dv('BLE-03', tri('بیکن BLE-03', 'BLE-03 بیکن', 'BLE beacon BLE-03'), 'ble', 'BLE', num('RSSI −62'), 'on', 77, -62, sites.hq, null),
  ];
}

export function seedAlerts(cells: number): NewAlert[] {
  return [
    { level: 'critical', title: tri('حرکت غیرمجاز در ساحهٔ ممنوعه', 'په منع شوې سیمه کې غیرمجاز خوځښت', 'Unauthorised movement in the restricted zone'),
      src: tri('درون D-01 · YOLOv8 ۹۲٪ · ۳۰۰ متری الفا', 'ډرون D-01 · YOLOv8 ۹۲٪ · له الفا ۳۰۰ متره', 'Drone D-01 · YOLOv8 92% · 300 m from Alpha'), unit: 'alpha', ackInSeconds: 42 },
    { level: 'error', title: tri('قطع مخابره با تیم چارلی', 'له چارلي ټیم سره اړیکه پرې شوه', 'Team Charlie comms lost'),
      src: tri('آخرین سگنال ۳ دقیقه پیش · ردیابی سلولی', 'وروستی سیګنال ۳ دقیقې مخکې · سلولي تعقیب', 'Last signal 3 min ago · cellular tracking'), unit: 'charlie', ackInSeconds: 170 },
    { level: 'warning', title: tri('HDOP بلند در رسیور GPS-07', 'په GPS-07 رسیور کې لوړ HDOP', 'High HDOP on receiver GPS-07'),
      src: tri('دقت موقعیت کاهش یافته · CEP95 ۹٫۸ متر', 'د موقعیت دقت کم شوی · CEP95 ۹٫۸ متره', 'Position accuracy degraded · CEP95 9.8 m'), unit: null, ackInSeconds: 540 },
    { level: 'info', title: tri('تجدید شبکهٔ ریسک', 'د خطر شبکه تازه شوه', 'Risk grid refreshed'),
      src: tri(`جریان ریسک · ${localDigits('dr', cells)} خانه`, `د خطر جریان · ${localDigits('ps', cells)} خانې`, `risk stream · ${cells} cells`), unit: null, status: 'acknowledged' },
  ];
}
