/**
 * Server-originated text in Dari (Afghan standard), Pashto and English. `L(key, params)` returns a Tri whose
 * parameters are formatted per language (Afghan digits for Dari/Pashto; Tri params pick their own language).
 */
import { LANGS, isTri, tri, type Lang, type LText, type Tri } from './types';

const M = {
  // alerts
  'alert.panic': tri('PANIC فعال شد — {name}', 'PANIC فعال شو — {name}', 'PANIC activated — {name}'),
  'alert.panic.src': tri('موقعیت ثبت شد {pos} · مسیر E فعال شد', 'موقعیت ثبت شو {pos} · E لاره فعاله شوه', 'Position recorded {pos} · route E activated'),
  'alert.planPending': tri('پلان {id} منتظر تأیید قوماندان', 'پلان {id} د قوماندان تایید ته انتظار باسي', 'Plan {id} awaiting commander approval'),
  'alert.planPending.src': tri('ارسال توسط {name}', 'د {name} له خوا لېږل شوی', 'Sent by {name}'),
  'alert.report': tri('راپور رویداد · {unit}', 'د پېښې راپور · {unit}', 'Incident report · {unit}'),
  'alert.report.src': tri('ثبت دستی از کنسول', 'له کنسول څخه لاسي ثبت', 'Logged manually from the console'),
  'alert.sim.src': tri('شبیه‌سازی · {name}', 'شبیه‌سازي · {name}', 'Simulation · {name}'),
  'alert.blindSpot': tri('نقطهٔ کور جدید: {id} ({type})', 'نوی ړوند ټکی: {id} ({type})', 'New blind spot: {id} ({type})'),
  'alert.blindSpot.src': tri('{area} کیلومتر مربع · نزدیک {near}', '{area} مربع کیلومتره · {near} ته نږدې', '{area} km² · near {near}'),
  'alert.deviceOffline': tri('{device} آفلاین شد', '{device} آفلاین شو', '{device} went offline'),
  'alert.sync': tri('هماهنگ‌سازی از {branch}: {title}', 'له {branch} څخه همغږي: {title}', 'Synced from {branch}: {title}'),

  // blind spots
  'bs.type.network': tri('بدون پوشش شبکه', 'د شبکې پوښښ نشته', 'No network coverage'),
  'bs.type.monitoring': tri('بدون نظارت', 'بې څارنې', 'Unmonitored'),
  'bs.type.access': tri('دسترسی محدود', 'محدود لاسرسی', 'Limited access'),
  'bs.mit.network': tri('یک رله یا ریپیتر سیار نزدیک {near} مستقر شود', 'د {near} سره نږدې یو ګرځنده ریلې ځای پر ځای شي', 'Deploy a mobile relay near {near}'),
  'bs.mit.monitoring': tri('گشت درون یا کمرهٔ ثابت در این ساحه تعیین شود', 'په دې سیمه کې د ډرون ګزمه یا ثابته کمره وټاکل شي', 'Assign a drone patrol or install a fixed camera here'),
  'bs.mit.access': tri('مسیر دسترسی بدیل و هماهنگی قبلی لازم است', 'بدیله لاره او مخکینۍ همغږي اړینه ده', 'Plan an alternative approach and coordinate in advance'),
  'bs.detail.network': tri('بهترین سگنال {rssi} dBm · نزدیک‌ترین رله {relay} ({dist})', 'غوره سیګنال {rssi} dBm · نږدې ریلې {relay} ({dist})', 'Best signal {rssi} dBm · nearest relay {relay} ({dist})'),
  'bs.detail.monitoring': tri('نزدیک‌ترین کمره {camera} در {dist}', 'نږدې کمره {camera} په {dist} کې', 'Nearest camera {camera} at {dist}'),
  'bs.detail.restricted': tri('داخل {zone}', 'د {zone} دننه', 'Inside {zone}'),
  'bs.detail.noRoad': tri('فاصله تا نزدیک‌ترین سرک {dist}', 'تر نږدې سړک پورې واټن {dist}', 'Distance to nearest road {dist}'),

  // routing
  'route.P': tri('مسیر اصلی (کم‌خطرترین)', 'اصلي لاره (تر ټولو کم خطر)', 'Primary (lowest risk)'),
  'route.A': tri('مسیر بدیل', 'بدیله لاره', 'Alternate'),
  'route.C': tri('مسیر احتیاطی', 'احتیاطي لاره', 'Contingency'),
  'route.E': tri('مسیر اضطراری تا خانهٔ امن', 'تر خوندي کوره بېړنۍ لاره', 'Emergency to safe house'),
  'route.alert.high': tri('بخش پرخطر {len} در {road}', 'په {road} کې {len} لوړ خطر لرونکې برخه', 'High-risk stretch of {len} on {road}'),
  'route.alert.critical': tri('بخش بحرانی {len} در {road} — توقف ممنوع', 'په {road} کې {len} بحراني برخه — درېدل منع دي', 'Critical stretch of {len} on {road} — do not stop'),
  'route.alert.blind': tri('عبور از نقطهٔ کور {id} ({type}) به طول {len}', 'له {id} ړوند ټکي ({type}) څخه {len} تېرېدل', 'Crosses blind spot {id} ({type}) for {len}'),
  'route.road.unnamed': tri('سرک بی‌نام', 'بې نومه سړک', 'unnamed road'),
  'route.dest': tri('ورودی امن مقصد', 'د منزل خوندي دروازه', 'Secure destination entry'),
  'route.cp': tri('پوستهٔ تلاشی {n} · {road}', 'د تلاشۍ {n} پوسته · {road}', 'Checkpoint {n} · {road}'),
  'route.unreachable': tri('مسیر قابل محاسبه نیست', 'لاره نه شي محاسبه کېدای', 'No route could be computed'),

  // plan validation
  'val.pace': tri('هر {n} مسیر PACE تعریف شده‌اند', 'ټولې {n} PACE لارې ټاکل شوې دي', 'All {n} PACE routes are defined'),
  'val.paceMissing': tri('فقط {n} مسیر از ۴ مسیر PACE قابل محاسبه است', 'له ۴ PACE لارو یوازې {n} محاسبه کېږي', 'Only {n} of 4 PACE routes could be computed'),
  'val.coverage': tri('پوشش شبکه روی {pct}٪ مسیر اصلی', 'په اصلي لاره کې د شبکې پوښښ {pct}٪', 'Network coverage on {pct}% of the primary route'),
  'val.risk': tri('ریسک مسیر {k} ({risk}) بالاتر از آستانهٔ {th}', 'د {k} لارې خطر ({risk}) له {th} حد څخه لوړ دی', 'Route {k} risk ({risk}) above the {th} threshold'),
  'val.riskOk': tri('ریسک همهٔ مسیرها زیر آستانهٔ {th}', 'د ټولو لارو خطر له {th} حد څخه ټیټ دی', 'All routes below the {th} risk threshold'),
  'val.resources': tri('منابع با سطح VIP هم‌خوانی دارند', 'سرچینې د VIP کچې سره سمې دي', 'Resources match the VIP level'),
  'val.resourcesLow': tri('برای VIP سطح {v} دست‌کم {n} موتر لازم است', 'د {v} کچې VIP لپاره لږ تر لږه {n} موټرې اړینې دي', 'VIP level {v} needs at least {n} vehicles'),
  'val.edited': tri('مسیر {k} به صورت دستی ویرایش شده است (نسخهٔ {v})', '{k} لاره په لاسي ډول سمه شوې ده ({v} نسخه)', 'Route {k} was edited manually (version {v})'),

  // resources
  'res.armored': tri('{n} موتر زرهی', '{n} زغره‌وال موټر', '{n} armoured vehicles'),
  'res.team': tri('تیم پشتیبان {name}', 'د {name} ملاتړ ټیم', 'Support team {name}'),
  'res.drone': tri('درون {id}', 'ډرون {id}', 'Drone {id}'),
  'res.medical': tri('{name} روی مسیر', 'په لاره کې {name}', '{name} on route'),

  // area recommendations (intel/spatial-analysis)
  'area.safe': tri('ساحه امن است — خطری تشخیص نشد', 'سیمه خوندي ده — هېڅ خطر ونه موندل شو', 'Area clear — no threat detected'),
  'area.evacuate': tri('تخلیهٔ فوری توصیه می‌شود', 'سمدستي وتل وړاندیز کېږي', 'Immediate evacuation recommended'),
  'area.qrf': tri('با تیم عکس‌العمل سریع تماس بگیرید', 'له چټک غبرګون ټیم سره اړیکه ونیسئ', 'Contact the quick reaction force'),
  'area.readiness': tri('آماده‌باش تیم‌ها را بلند ببرید', 'د ټیمونو چمتووالی لوړ کړئ', 'Raise team readiness'),
  'area.caution': tri('از این ساحه با احتیاط عبور کنید', 'له دې سیمې څخه په احتیاط تېر شئ', 'Transit the area with caution'),
  'area.watch': tri('نظارت دوامدار توصیه می‌شود', 'دوامداره څارنه وړاندیز کېږي', 'Continuous monitoring recommended'),
  'area.types': tri('رویدادهای تشخیص‌شده: {types}', 'پېژندل شوې پېښې: {types}', 'Detected incidents: {types}'),

  // plans
  'plan.tbd': tri('تعیین نشده', 'نه دی ټاکل شوی', 'Not scheduled'),

  // devices
  'dev.cmd.rth': tri('بازگشت به پایگاه', 'اډې ته راستنېدل', 'Return to base'),
  'dev.cmd.goto': tri('پرواز به مختصات', 'مختصاتو ته الوتنه', 'Fly to coordinates'),
  'dev.cmd.quality': tri('تغییر کیفیت ویدیو', 'د ویډیو کیفیت بدلول', 'Change video quality'),
  'dev.cmd.call': tri('درخواست تماس', 'د اړیکې غوښتنه', 'Request call'),
  'dev.cmd.record': tri('ثبت کلیپ', 'کلیپ ثبتول', 'Record clip'),
  'dev.cmd.restart': tri('راه‌اندازی مجدد', 'بیا پیلول', 'Restart'),
  'dev.cmd.rate': tri('تغییر نرخ ارسال', 'د لېږد کچه بدلول', 'Change report rate'),
  'dev.cmd.calibrate': tri('کالیبراسیون', 'کالیبرېشن', 'Calibrate'),
  'dev.cmd.power': tri('خاموش/روشن', 'بندول/چالانول', 'Power toggle'),
  'dev.log.cmd': tri('فرمان «{cmd}» توسط {by}', '«{cmd}» امر د {by} له خوا', 'Command “{cmd}” by {by}'),
  'dev.log.registered': tri('ثبت دستگاه', 'د وسیلې ثبت', 'Device registered'),
  'dev.log.firmware': tri('به‌روزرسانی فرم‌ویر', 'د فرم‌ویر تازه کول', 'Firmware updated'),
  'dev.log.calibrated': tri('کالیبراسیون موفق', 'بریالی کالیبرېشن', 'Calibration successful'),
  'dev.log.position': tri('موقعیت {pos}', 'موقعیت {pos}', 'Position {pos}'),
  'dev.log.state': tri('حالت به {state} تغییر کرد', 'حالت {state} ته بدل شو', 'State changed to {state}'),
  'dev.state.on': tri('آنلاین', 'آنلاین', 'online'),
  'dev.state.off': tri('آفلاین', 'آفلاین', 'offline'),

  // reports
  'rep.title': tri('راپور خلاصهٔ {branch}', 'د {branch} لنډ راپور', '{branch} summary report'),
  'rep.period': tri('دوره: {from} تا {to}', 'موده: له {from} تر {to}', 'Period: {from} to {to}'),
  'rep.alerts': tri('اخطارها', 'خبرتیاوې', 'Alerts'),
  'rep.ackMedian': tri('میانهٔ زمان تأیید', 'د تایید منځنی وخت', 'Median time to ACK'),
  'rep.incidents': tri('رویدادهای فعال', 'فعالې پېښې', 'Active incidents'),
  'rep.plans': tri('پلان‌های اسکورت', 'د ساتنې پلانونه', 'Escort plans'),
  'rep.blindSpots': tri('نقاط کور', 'ړانده ټکي', 'Blind spots'),
  'rep.devices': tri('سلامت دستگاه‌ها', 'د وسیلو روغتیا', 'Device health'),
  'rep.sims': tri('تمرین‌های شبیه‌سازی', 'د شبیه‌سازۍ تمرینونه', 'Simulation exercises'),
  'rep.sync': tri('هماهنگ‌سازی بین شعبه‌ها', 'د څانګو ترمنځ همغږي', 'Inter-branch sync'),
  'rep.generated': tri('تهیه‌شده در {at} توسط {by}', 'په {at} کې د {by} له خوا چمتو شوی', 'Generated {at} by {by}'),
  'rep.metric': tri('شاخص', 'شاخص', 'Metric'),
  'rep.value': tri('مقدار', 'ارزښت', 'Value'),

  // generic
  'unit.m': tri('{n} متر', '{n} متره', '{n} m'),
  'unit.km': tri('{n} کیلومتر', '{n} کیلومتره', '{n} km'),
  'unit.min': tri('{n} دقیقه', '{n} دقیقې', '{n} min'),
  'unit.h': tri('{n} ساعت', '{n} ساعته', '{n} h'),
} satisfies Record<string, Tri>;

export type MsgKey = keyof typeof M;
export type Param = string | number | Tri;

const DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export function localDigits(lang: Lang, v: string | number): string {
  const s = String(v);
  return lang === 'en' ? s : s.replace(/\d/g, (d) => DIGITS[+d]).replace(/(\d|[۰-۹])\.(?=\d|[۰-۹])/g, '$1٫');
}

export function t(lang: Lang, key: MsgKey, params: Record<string, Param> = {}): string {
  return M[key][lang].replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined) return `{${k}}`;
    return isTri(v) ? v[lang] : localDigits(lang, v);
  });
}

export function L(key: MsgKey, params: Record<string, Param> = {}): Tri {
  return { dr: t('dr', key, params), ps: t('ps', key, params), en: t('en', key, params) };
}

export const lengthText = (m: number): Tri => (m >= 1000 ? L('unit.km', { n: (m / 1000).toFixed(1) }) : L('unit.m', { n: Math.round(m) }));
export const asTri = (v: LText): Tri => (typeof v === 'string' ? tri(v, v, v) : v);
export { LANGS };
