import { useBundle } from '@/context/BundleContext';
import { IceTakeDictionaryComponent } from '@/components/IceTakeDictionary';

const IcePage = () => {
  const { iceDictionary } = useBundle();
  if (!iceDictionary) return null;
  return <IceTakeDictionaryComponent dictionary={iceDictionary} />;
};

export default IcePage;


