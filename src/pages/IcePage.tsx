import { useBundle } from '@/context/BundleContext';
import { IceTakeDictionaryComponent } from '@/components/IceTakeDictionary';
import { CapabilityWarning } from '@/components/capabilities';
import type { ParsedIceTakeDictionary } from '@/lib/core/iceTakeDictionary';

const IcePage = () => {
  const { getResource } = useBundle();
  const iceDictionary = getResource<ParsedIceTakeDictionary>('iceTakeDictionary');
  if (!iceDictionary) return null;
  return (
    <div className="space-y-4">
      <CapabilityWarning featureId="icetake-dictionary" />
      <IceTakeDictionaryComponent dictionary={iceDictionary} />
    </div>
  );
};

export default IcePage;


