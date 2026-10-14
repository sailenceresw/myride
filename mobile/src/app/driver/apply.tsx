import { WebScreen } from '@/components/ui';
import { apiUrlFor, getApiToken } from '@/lib/api';
import { TOKEN_KEY } from '@/lib/auth';

// Driver KYC (documents, bank, live selfie) runs in the MyRide Drive web wizard, signed in with the app's session —
// like Uber, where onboarding is web-based and driving is native.
export default function Apply() {
  const inject = `try { localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, ${JSON.stringify(getApiToken() ?? '')}); } catch (e) {} true;`;
  return <WebScreen title="Driver application" source={{ uri: apiUrlFor('/driver.html') }} injectedJavaScriptBeforeContentLoaded={inject} />;
}
