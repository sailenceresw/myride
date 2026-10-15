import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { StyleSheet, Text } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { WebView } from 'react-native-webview';
import { POKHARA } from '@/lib/config';

export type Pt = { lat: number; lng: number };
export type MapMarker = { key: string; at: Pt; color?: string; emoji?: string; title?: string; size?: number };
export type MapLine = { coords: Pt[]; color: string; width: number };
export type Padding = { top: number; right: number; bottom: number; left: number };
export type MapHandle = {
  flyTo: (c: Pt, o?: { zoom?: number; heading?: number; pitch?: number; duration?: number }) => void;
  fit: (points: Pt[], pad?: Partial<Padding>) => void;
};
type Props = { markers?: MapMarker[]; lines?: MapLine[]; user?: Pt | null; padding?: Partial<Padding>; traffic?: boolean; onUserPan?: () => void; ref?: Ref<MapHandle> };

const PAD: Padding = { top: 0, right: 0, bottom: 0, left: 0 };
const ll = ({ lat, lng }: Pt) => ({ latitude: lat, longitude: lng });

/**
 * The app's map: same props on both backends.
 * - Native Google/Apple maps in store builds (EXPO_PUBLIC_HAS_MAPS_KEY=1 with GOOGLE_MAPS_*_KEY).
 * - Otherwise a Leaflet map in a WebView on OpenStreetMap tiles — Expo Go's Google key fails with "Authorization
 *   failure" and an unauthorised Google map draws nothing at all, not even custom tiles. OSM's tile servers need a
 *   Referer (the WebView's baseUrl provides one) and are for light use only: production uses the native maps.
 */
export const AppMap = process.env.EXPO_PUBLIC_HAS_MAPS_KEY ? NativeMap : WebMap;

function NativeMap({ markers = [], lines = [], user, padding, traffic, onUserPan, ref }: Props) {
  const map = useRef<MapView>(null);
  useImperativeHandle(ref, () => ({
    // Apple Maps zooms by altitude, Google by zoom: send both.
    flyTo: (c, { zoom = 16, heading, pitch, duration = 700 } = {}) => map.current?.animateCamera({ center: ll(c), zoom, altitude: 7e7 / 2 ** zoom, heading, pitch }, { duration }),
    fit: (points, pad) => map.current?.fitToCoordinates(points.map(ll), { edgePadding: { ...PAD, ...pad }, animated: true }),
  }), []);
  return (
    <MapView
      ref={map}
      style={StyleSheet.absoluteFill}
      initialRegion={{ ...POKHARA, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
      showsUserLocation={!!user}
      showsMyLocationButton={false}
      showsCompass={false}
      showsTraffic={traffic}
      onPanDrag={onUserPan}
      mapPadding={{ ...PAD, ...padding }}
    >
      {lines.map((l, i) => l.coords.length > 1 && <Polyline key={i} coordinates={l.coords.map(ll)} strokeColor={l.color} strokeWidth={l.width} lineCap="round" lineJoin="round" />)}
      {markers.map((m) => m.emoji
        ? <Marker key={m.key} coordinate={ll(m.at)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} title={m.title}><Text style={{ fontSize: m.size ?? 24 }}>{m.emoji}</Text></Marker>
        : <Marker key={m.key} coordinate={ll(m.at)} pinColor={m.color} title={m.title} />)}
    </MapView>
  );
}

// Leaflet page: draw(state) replaces markers/lines; fly (animated pan — flyTo would zoom-pulse on every GPS fix)
// and fit move the camera, offset for the bottom sheet.
const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#m{margin:0;height:100%;background:#eef0ec}.leaflet-div-icon{background:none;border:0}
.e{line-height:1;text-align:center;filter:drop-shadow(0 2px 3px #0005)}
.pin{width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px #0006}
.me{width:14px;height:14px;border-radius:50%;background:#1a73e8;border:3px solid #fff;box-shadow:0 0 0 8px #1a73e833}
.leaflet-control-attribution{font-size:9px}</style></head><body><div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
const map=L.map('m',{zoomControl:false}).setView([${POKHARA.latitude},${POKHARA.longitude}],14);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,referrerPolicy:'strict-origin-when-cross-origin',attribution:'© OpenStreetMap'}).addTo(map);
const layer=L.layerGroup().addTo(map);let pad={top:0,right:0,bottom:0,left:0};
const icon=m=>L.divIcon({iconSize:[40,40],html:m.me?'<div class="me" style="margin:10px"></div>':m.emoji?'<div class="e" style="font-size:'+(m.size||24)+'px;margin-top:'+(20-(m.size||24)/2)+'px">'+m.emoji+'</div>':'<div class="pin" style="margin:9px;background:'+m.color+'"></div>'});
const send=t=>window.ReactNativeWebView.postMessage(t);
map.on('dragstart',()=>send('pan'));
// Camera moves run one at a time (latest wins): Leaflet drops or overrides a move made while another animates.
let busy=false,next=null;
const move=(f,ms)=>{if(busy){next=[f,ms];return;}busy=true;let done=false;
  const end=()=>{if(done)return;done=true;busy=false;const n=next;next=null;if(n)move(...n);};
  map.once('moveend',end);setTimeout(end,ms+400);f();};window.mr={
  draw(s){pad=s.pad;layer.clearLayers();
    s.lines.forEach(l=>L.polyline(l.coords.map(p=>[p.lat,p.lng]),{color:l.color,weight:l.width,lineCap:'round',lineJoin:'round'}).addTo(layer));
    s.markers.forEach(m=>L.marker([m.at.lat,m.at.lng],{icon:icon(m),title:m.title||''}).addTo(layer));},
  fly(c,z,ms){move(()=>{const p=map.project([c.lat,c.lng],z).add([(pad.right-pad.left)/2,(pad.bottom-pad.top)/2]);map.setView(map.unproject(p,z),z,{animate:true,duration:ms/1000});},ms);},
  fit(pts,p){if(pts.length)move(()=>map.fitBounds(pts.map(x=>[x.lat,x.lng]),{paddingTopLeft:[p.left,p.top],paddingBottomRight:[p.right,p.bottom]}),600);}
};send('ready');
</script></body></html>`;

function WebMap({ markers = [], lines = [], user, padding, onUserPan, ref }: Props) {
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const queued = useRef<string | null>(null); // last camera move requested before the page loaded
  const pad = { ...PAD, ...padding };
  const run = (js: string) => { if (ready) web.current?.injectJavaScript(`${js};true;`); else queued.current = js; };

  useImperativeHandle(ref, () => ({
    flyTo: (c, { zoom = 16, duration = 700 } = {}) => run(`mr.fly(${JSON.stringify(c)},${zoom},${duration})`),
    fit: (points, p) => run(`mr.fit(${JSON.stringify(points)},${JSON.stringify({ ...PAD, ...p })})`),
  }));

  const state = JSON.stringify({ pad, lines: lines.filter((l) => l.coords.length > 1), markers: user ? [...markers, { key: 'me', at: user, me: true }] : markers });
  useEffect(() => {
    if (!ready) return;
    web.current?.injectJavaScript(`mr.draw(${state});${queued.current ?? ''};true;`);
    queued.current = null;
  }, [ready, state]);

  return (
    <WebView
      ref={web}
      style={StyleSheet.absoluteFill}
      source={{ html: HTML, baseUrl: 'https://myride.local/' }}
      originWhitelist={['*']}
      javaScriptEnabled
      scrollEnabled={false}
      overScrollMode="never"
      onMessage={(e) => (e.nativeEvent.data === 'ready' ? setReady(true) : onUserPan?.())}
    />
  );
}
