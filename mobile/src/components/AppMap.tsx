import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Platform, StyleSheet, Text, useColorScheme, View } from 'react-native';
import type MapView from 'react-native-maps';
import { WebView } from 'react-native-webview';
import { POKHARA } from '@/lib/config';

export type Pt = { lat: number; lng: number };
/** pickup / drop: pins with an optional label bubble · vehicle: round emoji badge · me: pulsing location dot. */
export type MapMarker = { key: string; at: Pt; kind?: 'pickup' | 'drop' | 'vehicle' | 'me'; color?: string; emoji?: string; label?: string; size?: number };
export type MapLine = { coords: Pt[]; color: string; width: number; casing?: boolean };
export type Padding = { top: number; right: number; bottom: number; left: number };
export type MapHandle = {
  flyTo: (c: Pt, o?: { zoom?: number; heading?: number; pitch?: number; duration?: number }) => void;
  fit: (points: Pt[], pad?: Partial<Padding>) => void;
};
type Props = { markers?: MapMarker[]; lines?: MapLine[]; user?: Pt | null; padding?: Partial<Padding>; traffic?: boolean; onUserPan?: () => void; ref?: Ref<MapHandle> };

const PAD: Padding = { top: 0, right: 0, bottom: 0, left: 0 };
const ll = ({ lat, lng }: Pt) => ({ latitude: lat, longitude: lng });
const PIN = { pickup: '#0b7a6f', drop: '#f29e1f' };

/**
 * The app's map: same props on both backends.
 * - Native Google/Apple maps in store builds (EXPO_PUBLIC_HAS_MAPS_KEY=1 with GOOGLE_MAPS_*_KEY), MyRide-styled.
 * - Otherwise a Leaflet map in a WebView on OpenStreetMap tiles — Expo Go's Google key fails with "Authorization
 *   failure" and an unauthorised Google map draws nothing at all, not even custom tiles. OSM's tile servers need a
 *   Referer (the WebView's baseUrl provides one) and are for light use only: production uses the native maps.
 */
// react-native-maps is native-only: load it lazily so the web preview (expo start --web) still runs.
const Maps: typeof import('react-native-maps') | null = Platform.OS === 'web' ? null : require('react-native-maps'); // eslint-disable-line @typescript-eslint/no-require-imports
export const AppMap = process.env.EXPO_PUBLIC_HAS_MAPS_KEY && Maps ? NativeMap : WebMap;

// Google Maps styles: quiet roads and POIs so MyRide's pins and route stand out.
const quiet = [{ featureType: 'poi.business', stylers: [{ visibility: 'off' }] }, { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] }];
const GOOGLE_STYLE = {
  light: [...quiet, { elementType: 'geometry', stylers: [{ saturation: -35 }, { lightness: 8 }] }, { featureType: 'water', stylers: [{ color: '#b9dde6' }] }],
  dark: [...quiet, { elementType: 'geometry', stylers: [{ color: '#1d2524' }] }, { elementType: 'labels.text.fill', stylers: [{ color: '#9fb1ae' }] }, { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c3836' }] }, { featureType: 'water', stylers: [{ color: '#0f2a30' }] }],
};

function NativeMap({ markers = [], lines = [], user, padding, traffic, onUserPan, ref }: Props) {
  const { default: Map, Marker, Polyline, PROVIDER_GOOGLE } = Maps!;
  const dark = useColorScheme() === 'dark';
  const map = useRef<MapView>(null);
  useImperativeHandle(ref, () => ({
    // Apple Maps zooms by altitude, Google by zoom: send both.
    flyTo: (c, { zoom = 16, heading, pitch, duration = 700 } = {}) => map.current?.animateCamera({ center: ll(c), zoom, altitude: 7e7 / 2 ** zoom, heading, pitch }, { duration }),
    fit: (points, pad) => map.current?.fitToCoordinates(points.map(ll), { edgePadding: { ...PAD, ...pad }, animated: true }),
  }), []);
  return (
    <Map
      ref={map}
      provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
      customMapStyle={GOOGLE_STYLE[dark ? 'dark' : 'light']}
      style={StyleSheet.absoluteFill}
      initialRegion={{ ...POKHARA, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
      showsUserLocation={!!user}
      showsMyLocationButton={false}
      showsCompass={false}
      showsTraffic={traffic}
      onPanDrag={onUserPan}
      mapPadding={{ ...PAD, ...padding }}
    >
      {lines.flatMap((l, i) => l.coords.length < 2 ? [] : [
        ...(l.casing !== false ? [<Polyline key={`c${i}`} coordinates={l.coords.map(ll)} strokeColor={dark ? '#0d1413' : '#ffffff'} strokeWidth={l.width + 4} lineCap="round" lineJoin="round" />] : []),
        <Polyline key={`l${i}`} coordinates={l.coords.map(ll)} strokeColor={l.color} strokeWidth={l.width} lineCap="round" lineJoin="round" />,
      ])}
      {markers.map((m) => (
        <Marker key={m.key} coordinate={ll(m.at)} anchor={m.kind === 'vehicle' ? { x: 0.5, y: 0.5 } : { x: 0.5, y: 1 }} tracksViewChanges={false}>
          {m.kind === 'vehicle'
            ? <View style={styles.veh}><Text style={{ fontSize: m.size ?? 20 }}>{m.emoji}</Text></View>
            : <View style={{ alignItems: 'center' }}>
                {!!m.label && <View style={[styles.bubble, dark && { backgroundColor: '#162020' }]}><Text style={[styles.bubbleText, dark && { color: '#e9f0ef' }]} numberOfLines={1}>{m.label}</Text></View>}
                <View style={[styles.pin, m.kind === 'drop' && { borderRadius: 6 }, { backgroundColor: m.color ?? PIN[m.kind === 'drop' ? 'drop' : 'pickup'] }]}><View style={styles.pinDot} /></View>
              </View>}
        </Marker>
      ))}
    </Map>
  );
}

// Leaflet page: draw(state) replaces markers/lines (and the light/dark theme); fly (animated pan — flyTo would
// zoom-pulse on every GPS fix) and fit move the camera, offset for the bottom sheet.
const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#m{margin:0;height:100%;background:#eef1ee}.leaflet-div-icon{background:none;border:0}
body.dark,body.dark #m{background:#111918}
.leaflet-tile-pane{filter:saturate(.55) brightness(1.05) contrast(.94)}
body.dark .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.82) contrast(.92) saturate(.45)}
.leaflet-control-attribution{font-size:9px;background:#ffffffb0!important}body.dark .leaflet-control-attribution{background:#111918b0!important;color:#9fb1ae}
.pw{display:flex;flex-direction:column;align-items:center;position:absolute;bottom:0;left:50%;transform:translateX(-50%)}
.bubble{background:#fff;color:#101a19;font:700 12px/1.2 system-ui,sans-serif;padding:6px 10px;border-radius:10px;box-shadow:0 2px 8px #0003;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis;margin-bottom:6px}
body.dark .bubble{background:#162020;color:#e9f0ef}
.pin{width:24px;height:24px;border-radius:50%;border:3px solid #fff;box-shadow:0 3px 8px #0005;display:flex;align-items:center;justify-content:center}
.pin.sq{border-radius:7px}.pin i{width:8px;height:8px;border-radius:50%;background:#fff}
.veh{width:36px;height:36px;border-radius:50%;background:#fff;box-shadow:0 2px 8px #0004;display:flex;align-items:center;justify-content:center;line-height:1}
body.dark .veh{background:#1e2a29}
.me{position:relative;width:16px;height:16px}.me b{position:absolute;inset:0;border-radius:50%;background:#1a73e8;border:3px solid #fff;box-shadow:0 1px 4px #0006}
.me i{position:absolute;inset:-14px;border-radius:50%;background:#1a73e855;animation:p 2s ease-out infinite}
@keyframes p{0%{transform:scale(.3);opacity:.9}100%{transform:scale(1.2);opacity:0}}</style></head><body><div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
const map=L.map('m',{zoomControl:false}).setView([${POKHARA.latitude},${POKHARA.longitude}],14);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,referrerPolicy:'strict-origin-when-cross-origin',attribution:'© OpenStreetMap'}).addTo(map);
const layer=L.layerGroup().addTo(map);let pad={top:0,right:0,bottom:0,left:0},dark=false;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const icon=m=>{
  if(m.kind==='me')return L.divIcon({iconSize:[16,16],html:'<div class="me"><i></i><b></b></div>'});
  if(m.kind==='vehicle')return L.divIcon({iconSize:[36,36],html:'<div class="veh" style="font-size:'+(m.size||20)+'px">'+m.emoji+'</div>'});
  const c=m.color||(m.kind==='drop'?'${PIN.drop}':'${PIN.pickup}');
  return L.divIcon({iconSize:[0,0],html:'<div class="pw">'+(m.label?'<div class="bubble">'+esc(m.label)+'</div>':'')+'<div class="pin'+(m.kind==='drop'?' sq':'')+'" style="background:'+c+'"><i></i></div></div>'});};
const send=t=>window.ReactNativeWebView.postMessage(t);
map.on('dragstart',()=>send('pan'));
// Camera moves run one at a time (latest wins): Leaflet drops or overrides a move made while another animates.
let busy=false,next=null;
const move=(f,ms)=>{if(busy){next=[f,ms];return;}busy=true;let done=false;
  const end=()=>{if(done)return;done=true;busy=false;const n=next;next=null;if(n)move(...n);};
  map.once('moveend',end);setTimeout(end,ms+400);f();};window.mr={
  draw(s){pad=s.pad;layer.clearLayers();document.body.classList.toggle('dark',!!s.dark);
    s.lines.forEach(l=>{const pts=l.coords.map(p=>[p.lat,p.lng]);
      if(l.casing!==false)L.polyline(pts,{color:s.dark?'#0d1413':'#fff',weight:l.width+5,lineCap:'round',lineJoin:'round',opacity:.95}).addTo(layer);
      L.polyline(pts,{color:l.color,weight:l.width,lineCap:'round',lineJoin:'round'}).addTo(layer);});
    s.markers.forEach(m=>L.marker([m.at.lat,m.at.lng],{icon:icon(m),zIndexOffset:m.kind==='vehicle'?0:m.kind==='me'?500:1000}).addTo(layer));},
  fly(c,z,ms){move(()=>{const p=map.project([c.lat,c.lng],z).add([(pad.right-pad.left)/2,(pad.bottom-pad.top)/2]);map.setView(map.unproject(p,z),z,{animate:true,duration:ms/1000});},ms);},
  fit(pts,p){if(pts.length)move(()=>map.fitBounds(pts.map(x=>[x.lat,x.lng]),{paddingTopLeft:[p.left,p.top],paddingBottomRight:[p.right,p.bottom]}),600);}
};send('ready');
</script></body></html>`;

function WebMap({ markers = [], lines = [], user, padding, onUserPan, ref }: Props) {
  const web = useRef<WebView>(null);
  const dark = useColorScheme() === 'dark';
  const [ready, setReady] = useState(false);
  const queued = useRef<string | null>(null); // last camera move requested before the page loaded
  const pad = { ...PAD, ...padding };
  const run = (js: string) => { if (ready) web.current?.injectJavaScript(`${js};true;`); else queued.current = js; };

  useImperativeHandle(ref, () => ({
    flyTo: (c, { zoom = 16, duration = 700 } = {}) => run(`mr.fly(${JSON.stringify(c)},${zoom},${duration})`),
    fit: (points, p) => run(`mr.fit(${JSON.stringify(points)},${JSON.stringify({ ...PAD, ...p })})`),
  }));

  const state = JSON.stringify({ pad, dark, lines: lines.filter((l) => l.coords.length > 1), markers: user ? [...markers, { key: 'me', at: user, kind: 'me' }] : markers });
  useEffect(() => {
    if (!ready) return;
    web.current?.injectJavaScript(`mr.draw(${state});${queued.current ?? ''};true;`);
    queued.current = null;
  }, [ready, state]);

  return (
    <WebView
      ref={web}
      style={[StyleSheet.absoluteFill, { backgroundColor: dark ? '#111918' : '#eef1ee' }]}
      source={{ html: HTML, baseUrl: 'https://myride.local/' }}
      originWhitelist={['*']}
      javaScriptEnabled
      scrollEnabled={false}
      overScrollMode="never"
      onMessage={(e) => (e.nativeEvent.data === 'ready' ? setReady(true) : onUserPan?.())}
    />
  );
}

const styles = StyleSheet.create({
  veh: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4 },
  bubble: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 6, maxWidth: 180, elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6 },
  bubbleText: { fontSize: 12, fontWeight: '700', color: '#101a19' },
  pin: { width: 24, height: 24, borderRadius: 12, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', elevation: 5, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4 },
  pinDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
});
