// The lighting the game shows when its environment clock starts: the first
// season of the retail dictionary (000_DLC24hr_SUN_A, clear sky) at 13:00,
// which is exactly one keyframe (ENV_KF_..._city_1300, id 0x49835F26), so no
// blend. Values are the keyframe's LightingData + ScatteringData verbatim
// (rounded to 7 significant digits). Used whenever no environment bundle is
// loaded in the workspace.

import type { EnvironmentLook } from './engineLighting';

const v = (x: number, y: number, z: number) => ({ x, y, z });

export const RETAIL_DAYLIGHT_LOOK: EnvironmentLook = {
	lighting: {
		mv3KeyLightColour: v(1.3013, 1.3013, 0.8077947),
		mv3SpecularColour: v(1.29467, 1.04666, 0.7765573),
		mv3KeyFillColour: v(0.850659, 0.97264, 0.9578276),
		mv3ShadowFillColour: v(0.3943672, 0.53843, 0.5542),
		mv3RightFillColour: v(0.6265466, 0.7117444, 0.7244),
		mv3LeftFillColour: v(0.6407207, 0.7244, 0.7225975),
		mv3UpFillColour: v(0.256, 0.2468037, 0.23101),
		mv3DownFillColour: v(0.6929589, 0.8382223, 0.89462),
		mfAmbientIrradianceScale: 0.4,
	},
	scattering: {
		mv3SkyTopColour: v(0.0522872, 0.4139541, 0.71732),
		mv3SkyHorColour: v(1.0175, 0.9679794, 0.8091381),
		mv3SkySunColour: v(1.001, 1.000962, 0.9760249),
		mfSkyHorPow: 0.5,
		mfSkySunPow: 13.1,
		mfSkyDrk: 0,
		mfSkyHorBleedScl: 5,
		mfSkyHorBleedPow: 4.3,
		mfSkySunBleedPow: 6.5,
		mv3ScattTopColour: v(0, 0.1, 0.3),
		mv3ScattHorColour: v(0.385183, 0.4814655, 0.528),
		mv3ScattSunColour: v(1, 1, 1),
		mfScattHorPow: 0,
		mfScattSunPow: 0,
		mfScattDrk: 0,
		mfScattHorBleedScl: 0.01,
		mfScattHorBleedPow: 0.01,
		mfScattSunBleedPow: 0.01,
		mafScattDist: [25, 1500],
		mfScattPow: 1,
		mfScattCap: 0.87,
	},
};
