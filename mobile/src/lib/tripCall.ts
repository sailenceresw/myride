import { Alert, Linking } from 'react-native';
import { api } from './api';

/**
 * Call the other person on a trip without either app holding their number: the server says what to dial
 * (MyRide's call bridge + the trip code, keyed in automatically after a pause; or, without a bridge, the number
 * for this call only). Only works while the trip is on.
 */
export async function callOnTrip(tripId: string) {
  try {
    const r = await api<{ masked: boolean; dial: string; code?: string }>('POST', `/api/trips/${tripId}/call`);
    await Linking.openURL(`tel:${r.dial}${r.masked && r.code ? `,,${r.code}%23` : ''}`); // ",," = pause, %23 = #
  } catch (e) {
    Alert.alert('Call', (e as Error).message);
  }
}
