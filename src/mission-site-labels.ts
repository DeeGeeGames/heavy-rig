import type { MissionMap } from './campaign-types';
import { FACILITY_TARGET_ID } from './missions';

export const missionSiteName = function (map: MissionMap | undefined, index: number) {
	return map?.terrain?.compounds?.find(function (compound) { return compound.siteIndex === index; })?.name;
};

export const missionFacilityName = function (map: MissionMap | undefined, targetId: number) {
	return missionSiteName(map, targetId === FACILITY_TARGET_ID ? 0 : -2 - targetId);
};
