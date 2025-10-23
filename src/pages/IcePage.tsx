import { useBundle } from '@/context/BundleContext';
import { IceTakeDictionaryComponent } from '@/components/IceTakeDictionary';
import { CapabilityWarning } from '@/components/capabilities';

const IcePage = () => {
  const { iceDictionary } = useBundle();
  if (!iceDictionary) return null;
  return (
    <div className="space-y-4">
      <CapabilityWarning featureId="icetake-dictionary" />
      <IceTakeDictionaryComponent dictionary={iceDictionary} />
    </div>
  );
};

export default IcePage;


