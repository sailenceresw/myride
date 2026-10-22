import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Platform, StyleSheet, Text, useColorScheme, View } from 'react-native';
import type MapView from 'react-native-maps';
import { WebView } from 'react-native-webview';
import { POKHARA } from '@/lib/config';

export type Pt = { lat: number; lng: number };
/**
 * pickup (black circle) / drop (black square): pin on a stem with an optional label and ETA block, like Uber.
 * vehicle: top-down car / bike pointing along `heading` (`vehicle` = vehicle type) · me: pulsing location dot.
 */
export type MapMarker = {
  key: string; at: Pt; kind?: 'pickup' | 'drop' | 'stop' | 'vehicle' | 'me'; color?: string; // stop: small grey square
  label?: string; eta?: string; vehicle?: string; heading?: number | null; emoji?: string; size?: number;
};
export type MapLine = { coords: Pt[]; color: string; width: number; casing?: boolean };
export type Padding = { top: number; right: number; bottom: number; left: number };
export type MapHandle = {
  flyTo: (c: Pt, o?: { zoom?: number; heading?: number; pitch?: number; duration?: number }) => void;
  fit: (points: Pt[], pad?: Partial<Padding>) => void;
};
/** onIdle: the map's centre each time it comes to rest (pin-on-map picking). */
type Props = { markers?: MapMarker[]; lines?: MapLine[]; user?: Pt | null; padding?: Partial<Padding>; traffic?: boolean; onUserPan?: () => void; onIdle?: (centre: Pt) => void; ref?: Ref<MapHandle> };

const PAD: Padding = { top: 0, right: 0, bottom: 0, left: 0 };
const ll = ({ lat, lng }: Pt) => ({ latitude: lat, longitude: lng });
const INK = '#111111';
const STOP = '#6b7273'; // stops on the way: grey, so the destination stays the one black square

/**
 * The app's map: same props on both backends.
 * - Native Google/Apple maps in store builds (EXPO_PUBLIC_HAS_MAPS_KEY=1 with GOOGLE_MAPS_*_KEY), with a muted grey style.
 * - Otherwise a MapLibre map in a WebView on OpenFreeMap's vector tiles (Positron / dark styles, OpenStreetMap data;
 *   free, no key) — Expo Go's Google key fails with "Authorization failure".
 */
// react-native-maps is native-only: load it lazily so the web preview (expo start --web) still runs.
const Maps: typeof import('react-native-maps') | null = Platform.OS === 'web' ? null : require('react-native-maps'); // eslint-disable-line @typescript-eslint/no-require-imports
export const AppMap = process.env.EXPO_PUBLIC_HAS_MAPS_KEY && Maps ? NativeMap : WebMap;

// Google Maps styles in the spirit of Uber's: grey land, white roads, no business POIs or icons.
const GOOGLE_STYLE = {
  light: [
    { elementType: 'geometry', stylers: [{ color: '#f2f3f3' }] }, { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#6b6f70' }] }, { elementType: 'labels.text.stroke', stylers: [{ color: '#f2f3f3' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#e8eaea' }] }, { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#dfe9df' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] }, { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e1e3e3' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] }, { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#cfdde4' }] },
  ],
  dark: [
    { elementType: 'geometry', stylers: [{ color: '#1c1e1f' }] }, { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#8a8f90' }] }, { elementType: 'labels.text.stroke', stylers: [{ color: '#1c1e1f' }] },
    { featureType: 'poi.business', stylers: [{ visibility: 'off' }] }, { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1f2a22' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c2f30' }] }, { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3a3e3f' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] }, { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f1a20' }] },
  ],
};

function NativeMap({ markers = [], lines = [], user, padding, traffic, onUserPan, onIdle, ref }: Props) {
  const { default: Map, Marker, Polyline, PROVIDER_GOOGLE } = Maps!;
  const dark = useColorScheme() === 'dark';
  const map = useRef<MapView>(null);
  useImperativeHandle(ref, () => ({
    // Apple Maps zooms by altitude, Google by zoom: send both.
    flyTo: (c, { zoom = 16, heading, pitch, duration = 700 } = {}) => map.current?.animateCamera({ center: ll(c), zoom, altitude: 7e7 / 2 ** zoom, heading, pitch }, { duration }),
    fit: (points, pad) => map.current?.fitToCoordinates(points.map(ll), { edgePadding: { ...PAD, ...pad }, animated: true }),
  }), []);
  const fg = dark ? '#ffffff' : INK;
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
      showsPointsOfInterests={false}
      showsTraffic={traffic}
      onPanDrag={onUserPan}
      onRegionChangeComplete={onIdle ? (r) => onIdle({ lat: r.latitude, lng: r.longitude }) : undefined}
      mapPadding={{ ...PAD, ...padding }}
    >
      {lines.flatMap((l, i) => l.coords.length < 2 ? [] : [
        ...(l.casing !== false ? [<Polyline key={`c${i}`} coordinates={l.coords.map(ll)} strokeColor={dark ? '#000000' : '#ffffff'} strokeWidth={l.width + 4} lineCap="round" lineJoin="round" />] : []),
        <Polyline key={`l${i}`} coordinates={l.coords.map(ll)} strokeColor={dark && l.color === INK ? '#ffffff' : l.color} strokeWidth={l.width} lineCap="round" lineJoin="round" />,
      ])}
      {markers.map((m) => (
        <Marker key={m.key} coordinate={ll(m.at)} anchor={m.kind === 'vehicle' ? { x: 0.5, y: 0.5 } : { x: 0.5, y: 1 }} rotation={m.kind === 'vehicle' ? m.heading ?? 0 : 0} flat={m.kind === 'vehicle'} tracksViewChanges={false}>
          {m.kind === 'vehicle'
            ? <Text style={{ fontSize: m.size ?? 22 }}>{m.emoji}</Text>
            : <View style={{ alignItems: 'center' }}>
                {!!m.label && (
                  <View style={[styles.label, dark && { backgroundColor: '#1f2122' }]}>
                    {!!m.eta && <View style={styles.eta}><Text style={styles.etaText}>{m.eta}</Text></View>}
                    <Text style={[styles.labelText, dark && { color: '#fff' }]} numberOfLines={1}>{m.label}</Text>
                  </View>
                )}
                <View style={[styles.pin, m.kind !== 'pickup' && { borderRadius: 3 }, m.kind === 'stop' && { width: 14, height: 14 }, { backgroundColor: m.color ?? (m.kind === 'stop' ? STOP : fg) }]}><View style={[styles.pinDot, m.kind !== 'pickup' && { borderRadius: 1 }, m.kind === 'stop' && { width: 4, height: 4 }, { backgroundColor: dark ? INK : '#fff' }]} /></View>
                <View style={[styles.stem, { backgroundColor: m.color ?? fg }]} />
              </View>}
        </Marker>
      ))}
    </Map>
  );
}

// MapLibre page (vector tiles): draw(state) replaces markers/lines (and the light/dark style); fly and fit move the
// camera with padding for the bottom sheet.
const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css">
<style>html,body,#m{margin:0;height:100%;background:#f2f3f3;font-family:system-ui,-apple-system,Roboto,sans-serif}
body.dark,body.dark #m{background:#1c1e1f}
.maplibregl-ctrl-attrib{font-size:9px}body.dark .maplibregl-ctrl-attrib{background:#1c1e1fa0;color:#888}body.dark .maplibregl-ctrl-attrib a{color:#888}
.pw{display:flex;flex-direction:column;align-items:center}
.lab{display:flex;align-items:stretch;background:#fff;border-radius:6px;box-shadow:0 3px 10px #0003;overflow:hidden;margin-bottom:6px;max-width:210px}
body.dark .lab{background:#1f2122}
.lab b{display:flex;flex-direction:column;align-items:center;justify-content:center;background:#111;color:#fff;font:800 14px/1 inherit;padding:5px 8px;min-width:30px}
.lab b small{font:600 9px/1.2 inherit;opacity:.85}
.lab span{display:flex;align-items:center;gap:6px;color:#111;font:700 13px/1.2 inherit;padding:8px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body.dark .lab span{color:#fff}.lab span:after{content:'›';font-size:16px;color:#999}
.pin{width:18px;height:18px;border-radius:50%;background:#111;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px #0004}
.pin.sq{border-radius:3px}.pin i{width:6px;height:6px;border-radius:50%;background:#fff}.pin.sq i{border-radius:1px}
.stem{width:2px;height:12px;background:#111}
.pin.st{width:14px;height:14px;background:${STOP}}.pin.st i{width:4px;height:4px}.pin.st+.stem{background:${STOP};height:9px}
body.dark .pin,body.dark .stem{background:#fff}body.dark .pin i{background:#111}
.veh{display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 2px 2px #0005);transition:transform .8s}
.me{position:relative;width:18px;height:18px}.me b{position:absolute;inset:0;border-radius:50%;background:#276ef1;border:3px solid #fff;box-shadow:0 1px 4px #0006}
.me i{position:absolute;inset:-16px;border-radius:50%;background:#276ef144;animation:p 2s ease-out infinite}
@keyframes p{0%{transform:scale(.3);opacity:.9}100%{transform:scale(1.2);opacity:0}}</style></head><body><div id="m"></div>
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script><script>
// OpenFreeMap: free OpenStreetMap vector tiles, no key. Positron = Uber-like grey; dark for night mode.
const STYLES={light:'https://tiles.openfreemap.org/styles/positron',dark:'https://tiles.openfreemap.org/styles/dark'};
const map=new maplibregl.Map({container:'m',style:STYLES.light,center:[${POKHARA.longitude},${POKHARA.latitude}],zoom:13.5,dragRotate:false,pitchWithRotate:false,attributionControl:{compact:true}});
map.touchZoomRotate.disableRotation();
let pad={top:0,right:0,bottom:0,left:0},dark=false,lines=[],pins=[];
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// Top-down vehicles (pointing north, rotated to their heading).
const BODY={car:['#1b1f20','#5f6a6b'],car_ev:['#1b1f20','#5f6a6b'],jeep:['#2a2f30','#6b7677'],van:['#e9ecec','#4d5657'],pickup:['#2a2f30','#6b7677'],cargo:['#e9ecec','#4d5657'],truck_light:['#e9ecec','#4d5657'],truck:['#e9ecec','#4d5657']};
const LEN={van:42,pickup:40,cargo:44,truck_light:48,truck:54,jeep:38};
const carSvg=(t)=>{const[b,w]=BODY[t]||BODY.car,h=LEN[t]||36;return '<svg width="20" height="'+h+'" viewBox="0 0 20 '+h+'"><rect x="1.5" y="1" width="17" height="'+(h-2)+'" rx="6" fill="'+b+'" stroke="#0006" stroke-width=".6"/><rect x="4" y="7" width="12" height="6" rx="2" fill="'+w+'"/><rect x="4" y="'+(h-10)+'" width="12" height="4" rx="1.5" fill="'+w+'"/>'+(t==='car_ev'?'<rect x="9" y="15" width="2" height="'+(h-27)+'" fill="#1f9d55"/>':'')+'</svg>';};
const bikeSvg=(ev)=>'<svg width="16" height="32" viewBox="0 0 16 32"><rect x="6" y="1" width="4" height="9" rx="2" fill="#151819"/><rect x="6" y="22" width="4" height="9" rx="2" fill="#151819"/><rect x="1" y="8" width="14" height="2.6" rx="1.3" fill="#151819"/><ellipse cx="8" cy="16.5" rx="5" ry="7.5" fill="#2b3132"/><circle cx="8" cy="15" r="3.6" fill="'+(ev?'#1f9d55':'#f29e1f')+'" stroke="#0005" stroke-width=".6"/></svg>';
const vehicle=m=>{const bike=!m.vehicle||m.vehicle.startsWith('bike');return '<div class="veh" style="transform:rotate('+(m.heading||0)+'deg)">'+(bike?bikeSvg(m.vehicle==='bike_ev'):carSvg(m.vehicle))+'</div>';};
const el=html=>{const d=document.createElement('div');d.innerHTML=html;return d.firstChild;};
const markerEl=m=>{
  if(m.kind==='me')return el('<div class="me"><i></i><b></b></div>');
  if(m.kind==='vehicle')return el('<div style="width:56px;height:56px;display:flex;align-items:center;justify-content:center">'+vehicle(m)+'</div>');
  const eta=m.eta?String(m.eta).split(' '):null;
  return el('<div class="pw">'+(m.label?'<div class="lab">'+(eta?'<b>'+esc(eta[0])+(eta[1]?'<small>'+esc(eta.slice(1).join(' '))+'</small>':'')+'</b>':'')+'<span>'+esc(m.label)+'</span></div>':'')
    +'<div class="pin'+(m.kind==='drop'?' sq':m.kind==='stop'?' sq st':'')+'"'+(m.color?' style="background:'+m.color+'"':'')+'><i></i></div><div class="stem"'+(m.color?' style="background:'+m.color+'"':'')+'></div></div>');};
const send=t=>window.ReactNativeWebView.postMessage(t);
map.on('dragstart',()=>send('pan'));
map.on('moveend',()=>{const c=map.getCenter();send('idle:'+c.lat.toFixed(6)+','+c.lng.toFixed(6));});
// Route lines live in one GeoJSON source; re-added whenever the style (light/dark) reloads.
const lineData=()=>({type:'FeatureCollection',features:lines.map(l=>({type:'Feature',properties:{color:dark&&l.color==='${INK}'?'#fff':l.color,width:l.width,casing:l.casing!==false},geometry:{type:'LineString',coordinates:l.coords.map(p=>[p.lng,p.lat])}}))});
const applyLines=()=>{if(!map.isStyleLoaded())return;const src=map.getSource('mr');if(src)return src.setData(lineData());
  map.addSource('mr',{type:'geojson',data:lineData()});
  map.addLayer({id:'mr-casing',type:'line',source:'mr',filter:['get','casing'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':dark?'#000':'#fff','line-width':['+',['get','width'],4]}});
  map.addLayer({id:'mr-line',type:'line',source:'mr',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','color'],'line-width':['get','width']}});};
map.on('style.load',applyLines);
window.mr={
  draw(s){pad=s.pad;
    if(!!s.dark!==dark){dark=!!s.dark;document.body.classList.toggle('dark',dark);map.setStyle(STYLES[dark?'dark':'light']);}
    lines=s.lines;applyLines();
    pins.forEach(p=>p.remove());
    pins=s.markers.map(m=>{const e=markerEl(m);e.style.zIndex=m.kind==='vehicle'?1:m.kind==='me'?2:3;
      return new maplibregl.Marker({element:e,anchor:m.kind==='vehicle'||m.kind==='me'?'center':'bottom'}).setLngLat([m.at.lng,m.at.lat]).addTo(map);});},
  fly(c,z,ms){map.easeTo({center:[c.lng,c.lat],zoom:z,duration:ms,padding:pad});},
  fit(pts,p){if(!pts.length)return;const b=new maplibregl.LngLatBounds();pts.forEach(x=>b.extend([x.lng,x.lat]));map.fitBounds(b,{padding:p,maxZoom:16.5,duration:600});}
};send('ready');
</script></body></html>`;

function WebMap({ markers = [], lines = [], user, padding, onUserPan, onIdle, ref }: Props) {
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
      style={[StyleSheet.absoluteFill, { backgroundColor: dark ? '#1c1e1f' : '#f2f3f3' }]}
      source={{ html: HTML, baseUrl: 'https://myride.local/' }}
      originWhitelist={['*']}
      javaScriptEnabled
      scrollEnabled={false}
      overScrollMode="never"
      onMessage={(e) => {
        const msg = e.nativeEvent.data;
        if (msg === 'ready') setReady(true);
        else if (msg === 'pan') onUserPan?.();
        else if (msg.startsWith('idle:')) { const [lat, lng] = msg.slice(5).split(',').map(Number); onIdle?.({ lat, lng }); }
      }}
    />
  );
}

const styles = StyleSheet.create({
  label: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: '#fff', borderRadius: 6, overflow: 'hidden', marginBottom: 6, maxWidth: 210, elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6 },
  eta: { backgroundColor: INK, paddingHorizontal: 8, justifyContent: 'center' },
  etaText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  labelText: { fontSize: 13, fontWeight: '700', color: INK, paddingHorizontal: 10, paddingVertical: 8 },
  pin: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3 },
  pinDot: { width: 6, height: 6, borderRadius: 3 },
  stem: { width: 2, height: 12 },
});
