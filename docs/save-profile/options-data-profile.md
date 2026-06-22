# Profile/Burnout Paradise/Options Data Profile

> Source: https://burnout.wiki/wiki/Profile/Burnout_Paradise/Options_Data_Profile (mirrored 2026-06-22)

> Subpage: Development — Information on the development of the options data profile.

The options data profile contains all options used by the game, including volume, soundtrack, brightness/contrast, gamma, camera, and controller settings. It also stores saved online routes.

**Note:** On PC, some settings are stored in an external configuration file, config.ini, rather than the profile.

## Structures

### BrnGui::OptionsDataProfile_1_0

#### PlayStation 3, Xbox 360

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber |  | 12 |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x3980 | OnlineSaveRoute[10] | maCreatedOnlineGameOptions |  |  |
| 0x3988 | 0x3980 | OnlineSaveRoute[10] | maReceivedOnlineGameOptions |  |  |
| 0x7308 | 0x4 | int32_t | miNumCreatedOnlineGameOptions |  |  |
| 0x730C | 0x4 | int32_t | miNumReceivedOnlineGameOptions |  |  |
| 0x7310 | 0x10 | EATraxArrayType | mTraxAvailableInFreeBurn |  |  |
| 0x7320 | 0x10 | EATraxArrayType | mTraxAvailableInEvents |  |  |
| 0x7330 | 0x10 | EATraxArrayType | mTraxFullyPlayed |  |  |
| 0x7340 | 0x4 | ETraxPlayOrderMode | meTraxPlayOrderMode |  |  |
| 0x7344 | 0x4 | int32_t | miLastPlayedSongIndex |  |  |
| 0x7348 | 0x4 | int32_t | miLastPictureParadiseMusicIndex |  |  |
| 0x734C | 0x4 | DirectorProfileData | mDirectorProfileData |  |  |
| 0x7350 | 0x4 | int32_t | mBrightness |  |  |
| 0x7354 | 0x4 | int32_t | mContrast |  |  |
| 0x7358 | 0x4 | int32_t | miVoipVolume |  |  |
| 0x735C | 0x4 | int32_t | mMusicVolume |  |  |
| 0x7360 | 0x4 | int32_t | mSFXVolume |  |  |
| 0x7364 | 0x4 | ECameraUserOptions | meCameraFeedSetting |  |  |
| 0x7368 | 0x1 | bool | mbIsNewsUnread |  |  |
| 0x7369 | 0x1 | bool | mbSixAxisShowtime |  |  |
| 0x736A | 0x1 | bool | mbSixAxisSteering |  |  |
| 0x736B | 0x1 | bool | mbForceFeedback |  |  |
| 0x736C | 0x1 | bool | mbDefaultGameCamera |  | Unused (not written to) |
| 0x736D | 0x1 | bool | mbTips |  |  |
| 0x736E | 0x1 | bool | mbIsLocked |  |  |
| 0x736F | 0x1 |  |  | Padding |  |

#### PC

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber |  | 15 |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x3980 | OnlineSaveRoute[10] | maCreatedOnlineGameOptions |  |  |
| 0x3988 | 0x3980 | OnlineSaveRoute[10] | maReceivedOnlineGameOptions |  |  |
| 0x7308 | 0x4 | int32_t | miNumCreatedOnlineGameOptions |  |  |
| 0x730C | 0x4 | int32_t | miNumReceivedOnlineGameOptions |  |  |
| 0x7310 | 0x10 | EATraxArrayType | mTraxAvailableInFreeBurn |  |  |
| 0x7320 | 0x10 | EATraxArrayType | mTraxAvailableInEvents |  |  |
| 0x7330 | 0x10 | EATraxArrayType | mTraxFullyPlayed |  |  |
| 0x7340 | 0x4 | ETraxPlayOrderMode | meTraxPlayOrderMode |  |  |
| 0x7344 | 0x4 | int32_t | miLastPlayedSongIndex |  |  |
| 0x7348 | 0x4 | int32_t | miLastPictureParadiseMusicIndex |  |  |
| 0x734C | 0x4 | DirectorProfileData | mDirectorProfileData |  |  |
| 0x7350 | 0x4 | int32_t | mBrightness |  |  |
| 0x7354 | 0x4 | int32_t | mContrast |  |  |
| 0x7358 | 0x4 | float32_t | ? | Gamma |  |
| 0x735C | 0x4 | int32_t | miVoipVolume |  |  |
| 0x7360 | 0x4 | int32_t | mMusicVolume |  |  |
| 0x7364 | 0x4 | int32_t | mSFXVolume |  |  |
| 0x7368 | 0x4 | ECameraUserOptions | meCameraFeedSetting |  |  |
| 0x736C | 0x1 | bool | mbIsNewsUnread |  |  |
| 0x736D | 0x1 | bool | mbSixAxisShowtime |  |  |
| 0x736E | 0x1 | bool | mbSixAxisSteering |  |  |
| 0x736F | 0x1 | bool | mbForceFeedback |  |  |
| 0x7370 | 0x1 | bool | mbDefaultGameCamera |  | Unused (not written to) |
| 0x7371 | 0x1 | bool | mbTips |  |  |
| 0x7372 | 0x400 | char[1024] | ? | Autologin information? | Token? First 0x2A always same |
| 0x7772 | 0x2 |  |  | Padding |  |
| 0x7774 | 0x4 | uint32_t | ? |  | Always 1 |
| 0x7778 | 0x1 | uint8_t | ? | mbIsLocked? | Always 0 |
| 0x7779 | 0x7 |  |  | Padding |  |

#### Remastered

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | int32_t | miVersionNumber |  | 12 |
| 0x4 | 0x4 |  |  | Padding |  |
| 0x8 | 0x3980 | OnlineSaveRoute[10] | maCreatedOnlineGameOptions |  |  |
| 0x3988 | 0x3980 | OnlineSaveRoute[10] | maReceivedOnlineGameOptions |  |  |
| 0x7308 | 0x4 | int32_t | miNumCreatedOnlineGameOptions |  |  |
| 0x730C | 0x4 | int32_t | miNumReceivedOnlineGameOptions |  |  |
| 0x7310 | 0x10 | EATraxArrayType | mTraxAvailableInFreeBurn |  |  |
| 0x7320 | 0x10 | EATraxArrayType | mTraxAvailableInEvents |  |  |
| 0x7330 | 0x10 | EATraxArrayType | mTraxFullyPlayed |  |  |
| 0x7340 | 0x4 | ETraxPlayOrderMode | meTraxPlayOrderMode |  |  |
| 0x7344 | 0x4 | int32_t | miLastPlayedSongIndex |  |  |
| 0x7348 | 0x4 | int32_t | miLastPictureParadiseMusicIndex |  |  |
| 0x734C | 0x4 | DirectorProfileData | mDirectorProfileData |  |  |
| 0x7350 | 0x4 | int32_t | mBrightness |  |  |
| 0x7354 | 0x4 | int32_t | mContrast |  |  |
| 0x7358 | 0x4 | float32_t | ? | Gamma |  |
| 0x735C | 0x400 | char[1024] | ? | Autologin information? | Null in Remastered |
| 0x775C | 0x4 | int32_t | miVoipVolume |  |  |
| 0x7760 | 0x4 | int32_t | mMusicVolume |  |  |
| 0x7764 | 0x4 | int32_t | mSFXVolume |  |  |
| 0x7768 | 0x4 | ECameraUserOptions | meCameraFeedSetting |  |  |
| 0x776C | 0x1 | bool | mbIsNewsUnread |  |  |
| 0x776D | 0x1 | bool | mbSixAxisShowtime |  |  |
| 0x776E | 0x1 | bool | mbSixAxisSteering |  |  |
| 0x776F | 0x1 | bool | mbForceFeedback |  |  |
| 0x7770 | 0x1 | bool | mbDefaultGameCamera |  | Unused (not written to) |
| 0x7771 | 0x1 | bool | mbTips |  |  |
| 0x7772 | 0x1 | bool | mbIsLocked |  |  |
| 0x7773 | 0x5 |  |  | Padding |  |

### BrnGui::OptionsDataProfile::OnlineSaveRoute

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x5A0 | OnlineSaveRouteEvent[10] | maEvents |  |  |
| 0x5A0 | 0x4 | EGameModeType | meGameMode |  |  |
| 0x5A4 | 0x4 | EBoostType | meBoostType |  |  |
| 0x5A8 | 0x4 | EVehicleChoice | meVehicleChoice |  |  |
| 0x5AC | 0x4 | int32_t | miTimeLimit |  |  |
| 0x5B0 | 0x4 | int32_t | miNumRounds |  |  |
| 0x5B4 | 0x4 | int32_t | miVehicleClass |  |  |
| 0x5B8 | 0x4 | int32_t | miNumRunnerCrashes |  |  |
| 0x5BC | 0x1 | bool | mbInfiniteBoost |  |  |
| 0x5BD | 0x1 | bool | mbTrafficOn |  |  |
| 0x5BE | 0x1 | bool | mbTrafficCheckingOn |  |  |
| 0x5BF | 0x1 |  |  | Padding |  |

### BrnGui::OptionsDataProfile::OnlineSaveRoute::OnlineSaveRouteEvent

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x80 | CgsID[16] | maLandmarkIndices | Checkpoint and finish Landmarks from Trigger Data |  |
| 0x80 | 0x4 | uint32_t | mJunctionId | Event start junction from Traffic Data |  |
| 0x84 | 0x4 | int32_t | miNumLandmarks | Number of checkpoints, including finish |  |
| 0x88 | 0x4 | int32_t | miEventID | Event tied to the junction in Traffic Data |  |
| 0x8C | 0x4 |  |  | Padding |  |

### BrnDirector::GameState::DirectorProfileData

| Offset | Length | Type | Name | Description | Comments |
| --- | --- | --- | --- | --- | --- |
| 0x0 | 0x4 | ECameraMode | meCameraMode |  |  |

## Typedefs

### BrnGui::GuiEventAudioTraxUpdate::EATraxArrayType

| Name | Type | Length | Comments |
| --- | --- | --- | --- |
| EATraxArrayType | FastBitArray<128u> | 0x10 |  |

## Enumerations

### BrnGameState::GameStateModuleIO::EGameModeType

| Name | Value | Comments |
| --- | --- | --- |
| E_MODE_NONE | -1 |  |
| E_MODE_OFFLINE_RACE | 0 |  |
| E_MODE_FACE_OFF | 1 |  |
| E_MODE_OFFLINE_SHOWTIME | 2 |  |
| E_MODE_ROAD_RAGE | 3 |  |
| E_MODE_PURSUIT | 4 |  |
| E_MODE_BURNING_ROUTE | 5 |  |
| E_MODE_ELIMINATOR | 6 |  |
| E_MODE_STUNT_ATTACK | 7 |  |
| E_MODE_MARKED_MAN | 8 |  |
| E_MODE_TRAFFIC_ATTACK | 9 |  |
| E_MODE_OFFLINE_COUNT | 10 |  |
| E_MODE_ONLINE_MODE_START | 10 |  |
| E_MODE_ONLINE_RACE | 10 |  |
| E_MODE_ONLINE_ROAD_RAGE | 11 |  |
| E_MODE_ONLINE_FUGITIVE | 12 |  |
| E_MODE_ONLINE_BURNING_HOME_RUN | 13 |  |
| E_MODE_ONLINE_FREE_BURN | 14 |  |
| E_MODE_ONLINE_FREE_BURN_LOBBY | 15 |  |
| E_MODE_ONLINE_SHOWTIME | 16 |  |
| E_MODE_ONLINE_MODE_END | 17 |  |
| E_MODE_COUNT | 17 |  |

### BrnNetwork::EBoostType

| Name | Value | Comments |
| --- | --- | --- |
| E_BOOST_TYPE_NORMAL | 0 |  |
| E_BOOST_TYPE_DANGER | 1 |  |
| E_BOOST_TYPE_AGGRESSION | 2 |  |
| E_BOOST_TYPE_STUNT | 3 |  |
| E_BOOST_TYPE_INFINITE | 4 |  |
| E_BOOST_TYPE_COUNT | 5 |  |

### BrnNetwork::EVehicleChoice

| Name | Value | Comments |
| --- | --- | --- |
| E_VEHICLE_CHOICE_FREE | 0 |  |
| E_VEHICLE_CHOICE_HOST | 1 |  |
| E_VEHICLE_CHOICE_COUNT | 2 |  |

### BrnGui::GuiEventAudioTraxPlayOrder::ETraxPlayOrderMode

| Name | Value | Comments |
| --- | --- | --- |
| E_TRAX_PLAY_ORDER_MODE_SEQUENTIAL | 0 |  |
| E_TRAX_PLAY_ORDER_MODE_RANDOM | 1 |  |
| E_TRAX_PLAY_ORDER_MODE_COUNT | 2 |  |

### BrnDirector::GameState::ECameraMode

| Name | Value | Comments |
| --- | --- | --- |
| E_CAMERA_MODE_FIRST_PERSON | 0 |  |
| E_CAMERA_MODE_THIRD_PERSON | 1 |  |
| E_CAMERA_MODE_COUNT | 2 |  |

### BrnNetwork::BrnNetworkModuleIO::ECameraUserOptions

| Name | Value | Comments |
| --- | --- | --- |
| CAMERA_USER_OFF | 0 |  |
| CAMERA_USER_ON | 1 |  |
| CAMERA_USER_FRIENDS_ONLY | 2 |  |
