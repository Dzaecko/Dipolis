/* simulate.cpp
 *
 * Micropolis, Unix Version.  This game was released for the Unix platform
 * in or about 1990 and has been modified for inclusion in the One Laptop
 * Per Child program.  Copyright (C) 1989 - 2007 Electronic Arts Inc.  If
 * you need assistance with this program, you may contact:
 *   http://wiki.laptop.org/go/Micropolis  or email  micropolis@laptop.org.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at
 * your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.  You should have received a
 * copy of the GNU General Public License along with this program.  If
 * not, see <http://www.gnu.org/licenses/>.
 *
 *             ADDITIONAL TERMS per GNU GPL Section 7
 *
 * No trademark or publicity rights are granted.  This license does NOT
 * give you any right, title or interest in the trademark SimCity or any
 * other Electronic Arts trademark.  You may not distribute any
 * modification of this program using the trademark SimCity or claim any
 * affliation or association with Electronic Arts Inc. or its employees.
 *
 * Any propagation or conveyance of this program must include this
 * copyright notice and these terms.
 *
 * If you convey this program (or any modifications of it) and assume
 * contractual liability for the program to recipients of it, you agree
 * to indemnify Electronic Arts for any liability that those contractual
 * assumptions impose on Electronic Arts.
 *
 * You may not misrepresent the origins of this program; modified
 * versions of the program must be marked as such and not identified as
 * the original program.
 *
 * This disclaimer supplements the one included in the General Public
 * License.  TO THE FULLEST EXTENT PERMISSIBLE UNDER APPLICABLE LAW, THIS
 * PROGRAM IS PROVIDED TO YOU "AS IS," WITH ALL FAULTS, WITHOUT WARRANTY
 * OF ANY KIND, AND YOUR USE IS AT YOUR SOLE RISK.  THE ENTIRE RISK OF
 * SATISFACTORY QUALITY AND PERFORMANCE RESIDES WITH YOU.  ELECTRONIC ARTS
 * DISCLAIMS ANY AND ALL EXPRESS, IMPLIED OR STATUTORY WARRANTIES,
 * INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, SATISFACTORY QUALITY,
 * FITNESS FOR A PARTICULAR PURPOSE, NONINFRINGEMENT OF THIRD PARTY
 * RIGHTS, AND WARRANTIES (IF ANY) ARISING FROM A COURSE OF DEALING,
 * USAGE, OR TRADE PRACTICE.  ELECTRONIC ARTS DOES NOT WARRANT AGAINST
 * INTERFERENCE WITH YOUR ENJOYMENT OF THE PROGRAM; THAT THE PROGRAM WILL
 * MEET YOUR REQUIREMENTS; THAT OPERATION OF THE PROGRAM WILL BE
 * UNINTERRUPTED OR ERROR-FREE, OR THAT THE PROGRAM WILL BE COMPATIBLE
 * WITH THIRD PARTY SOFTWARE OR THAT ANY ERRORS IN THE PROGRAM WILL BE
 * CORRECTED.  NO ORAL OR WRITTEN ADVICE PROVIDED BY ELECTRONIC ARTS OR
 * ANY AUTHORIZED REPRESENTATIVE SHALL CREATE A WARRANTY.  SOME
 * JURISDICTIONS DO NOT ALLOW THE EXCLUSION OF OR LIMITATIONS ON IMPLIED
 * WARRANTIES OR THE LIMITATIONS ON THE APPLICABLE STATUTORY RIGHTS OF A
 * CONSUMER, SO SOME OR ALL OF THE ABOVE EXCLUSIONS AND LIMITATIONS MAY
 * NOT APPLY TO YOU.
 */

/**
 * @file simulate.cpp
 * @brief Handles the main simulation logic for Micropolis.
 *
 * This file contains the primary functions responsible for advancing
 * the simulation state in the Micropolis game. It includes methods
 * for handling various aspects of the game world, such as power
 * generation, population growth, resource management, and disaster
 * events. The simulation is divided into multiple phases, with each
 * phase focusing on specific components of the game world.
 */


////////////////////////////////////////////////////////////////////////


#include "micropolis.h"
#include "text.h"

#include <limits>


////////////////////////////////////////////////////////////////////////
// Constants

/**
 * How often to perform the short term census.
 * @todo Rename to CENSUS_MONTHLY_FREQUENCY or so?
 */
static const int CENSUS_FREQUENCY_10 = 4;

/**
 * How often to perform the long term census.
 * @todo Rename to CENSUS_YEARLY_FREQUENCY or so?
 */
static const int CENSUS_FREQUENCY_120 = CENSUS_FREQUENCY_10 * 12;

/**
 * How often to collect taxes.
 */
static const int TAX_FREQUENCY = 48;


////////////////////////////////////////////////////////////////////////


/* comefrom: doEditWindow scoreDoer doMapInFront graphDoer doNilEvent */
void Micropolis::simFrame()
{

    if (simSpeed == 0) {
        return;
    }

    if (++speedCycle > 1023) {
        speedCycle = 0;
    }

    if (simSpeed == 1 && (speedCycle % 5) != 0) {
        return;
    }

    if (simSpeed == 2 && (speedCycle % 3) != 0) {
        return;
    }

    simulate();
}


/* comefrom: simFrame */
void Micropolis::simulate()
{
    static const short speedPowerScan[3] =
        { 2,  4,  5 };
    static const short SpeedPollutionTerrainLandValueScan[3] =
        { 2,  7, 17 };
    static const short speedCrimeScan[3] =
        { 1,  8, 18 };
    static const short speedPopulationDensityScan[3] = 
        { 1,  9, 19 };
    static const short speedFireAnalysis[3] =
        { 1, 10, 20 };

    short speedIndex = clamp((short)(simSpeed - 1), (short)0, (short)2);

    //printf("simulate phaseCycle=%d initSimLoad %d\n", phaseCycle, initSimLoad);

    // The simulator has 16 different phases, which we cycle through
    // according to phaseCycle, which is incremented and wrapped at
    // the end of this switch.

    if (initSimLoad) {
        phaseCycle = 0;
    } else {
        phaseCycle &= 15;
    }

    switch (phaseCycle)  {

        case 0:

            if (++simCycle > 1023) {
                simCycle = 0; // This is cosmic!
            }

            if (doInitialEval) {
                doInitialEval = false;
                cityEvaluation();
            }

            cityTime++;
            cityTaxAverage += cityTax;

            if (!(simCycle & 1)) {
                setValves();
            }

            clearCensus();

            break;

        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
        case 6:
        case 7:
        case 8:

            // Scan 1/8 of the map for each of the 8 phases 1..8:
            mapScan((phaseCycle - 1) * WORLD_W / 8, phaseCycle * WORLD_W / 8);

            break;

        case 9:
            if ((rescueEnabled() || rescueParam("rescueTrackMetrics") > 0) &&
                cityTime % CITYTIMES_PER_MONTH == 0) {
                if (rescueEnabled()) updateRescueUnpoweredZones();
                updateRescue();
            }
            if (params.podsEnabled && cityTime % 4 == 0) updatePods();
            if (params.unrestEnabled && cityTime % 4 == 0) updateUnrest();
            if (cityTime % CENSUS_FREQUENCY_10 == 0) {
                take10Census();
            }

            if (cityTime % CENSUS_FREQUENCY_120 == 0) {
                take120Census();
            }

            if (cityTime % TAX_FREQUENCY == 0)  {
                collectTax();
                cityEvaluation();
            }

            break;

        case 10:

            if (!(simCycle % 5)) {
                decRateOfGrowthMap();
            }

            decTrafficMap();

            newMapFlags[MAP_TYPE_TRAFFIC_DENSITY] = 1;
            newMapFlags[MAP_TYPE_ROAD] = 1;
            newMapFlags[MAP_TYPE_ALL] = 1;
            newMapFlags[MAP_TYPE_RES] = 1;
            newMapFlags[MAP_TYPE_COM] = 1;
            newMapFlags[MAP_TYPE_IND] = 1;
            newMapFlags[MAP_TYPE_DYNAMIC] = 1;

            sendMessages();

            break;

        case 11:

            if ((simCycle % speedPowerScan[speedIndex]) == 0) {
                if (useOriginalPowerScanForTests) doPowerScanOriginal();
                else doPowerScan();
                newMapFlags[MAP_TYPE_POWER] = 1;
                newPower = true; /* post-release change */
            }

            break;

        case 12:

            if ((simCycle % SpeedPollutionTerrainLandValueScan[speedIndex]) == 0) {
                pollutionTerrainLandValueScan();
            }

            break;

        case 13:

            if ((simCycle % speedCrimeScan[speedIndex]) == 0) {
                crimeScan();
            }

            break;

        case 14:

            if ((simCycle % speedPopulationDensityScan[speedIndex]) == 0) {
                populationDensityScan();
            }

            break;

        case 15:

            if ((simCycle % speedFireAnalysis[speedIndex]) == 0) {
                fireAnalysis();
            }

            doDisasters();

            break;

    }

    // Go on the the next phase.
    phaseCycle = (phaseCycle + 1) & 15;
}


/**
 * Initialize simulation.
 * @todo Create constants for initSimLoad.
 */
void Micropolis::doSimInit()
{
    phaseCycle = 0;
    simCycle = 0;

    if (initSimLoad == 2) {
        /* if new city */
        initSimMemory();
    }

    if (initSimLoad == 1) {
        /* if city just loaded */
        simLoadInit();
    }

    setValves();
    clearCensus();
    mapScan(0, WORLD_W);
    if (useOriginalPowerScanForTests) doPowerScanOriginal();
    else doPowerScan();
    newPower = true;         /* post rel */
    pollutionTerrainLandValueScan();
    crimeScan();
    populationDensityScan();
    fireAnalysis();
    newMap = 1;
    censusChanged = true;
    totalPop = 1;
    doInitialEval = true;
}


/**
 * Copy bits from powerGridMap to the #PWRBIT in the map for all zones in the
 * world.
 */
void Micropolis::doNilPower()
{
    short x, y;

    for (x = 0; x < WORLD_W; x++) {
        for (y = 0; y < WORLD_H; y++) {
            MapValue z = map[x][y];
            if (z & ZONEBIT) {
                setZonePower(Position(x, y));
            }
        }
    }
}


/** Decrease traffic memory */
void Micropolis::decTrafficMap()
{
    /* tends to empty trafficDensityMap */
    short x, y, z;

    for (x = 0; x < WORLD_W; x += trafficDensityMap.MAP_BLOCKSIZE) {
        for (y = 0; y < WORLD_H; y += trafficDensityMap.MAP_BLOCKSIZE) {
            z = trafficDensityMap.worldGet(x, y);
            if (z == 0) {
                continue;
            }

            if (z <= 24) {
                trafficDensityMap.worldSet(x, y, 0);
                continue;
            }

            if (z > 200) {
                trafficDensityMap.worldSet(x, y, z - 34);
            } else {
                trafficDensityMap.worldSet(x, y, z - 24);
            }
        }
    }
}


/**
 * Decrease rate of grow.
 * @todo Limiting rate should not be done here, but when we add a new value to
 *       it.
 */
void Micropolis::decRateOfGrowthMap()
{
    /* tends to empty rateOfGrowthMap */
    short x, y, z;

    for (x = 0; x < rateOfGrowthMap.MAP_W; x++) {
        for (y = 0; y < rateOfGrowthMap.MAP_H; y++) {
            z = rateOfGrowthMap.get(x, y);
            if (z == 0) {
                continue;
            }

            if (z > 0) {
                z--;
                z = clamp(z, (short)-200, (short)200);
                rateOfGrowthMap.set(x, y, z);
                continue;
            }

            if (z < 0)  {
                z++;
                z = clamp(z, (short)-200, (short)200);
                rateOfGrowthMap.set(x, y, z);
            }
        }
    }
}


/* comefrom: doSimInit */
void Micropolis::initSimMemory()
{
    //printf("initSimMemory\n");

    setCommonInits();

    for (short x = 0; x < 240; x++)  {
        resHist[x] = 0;
        comHist[x] = 0;
        indHist[x] = 0;
        moneyHist[x] = 128;
        crimeHist[x] = 0;
        pollutionHist[x] = 0;
    }

    crimeRamp = 0;
    pollutionRamp = 0;
    totalPop = 0;
    resValve = 0;
    comValve = 0;
    indValve = 0;
    resCap = false; // Do not block residential growth
    comCap = false; // Do not block commercial growth
    indCap = false; // Do not block industrial growth

    externalMarket = 6.0;
    disasterEvent = SC_NONE;
    scoreType = SC_NONE;

    /* This clears powermem */
    powerStackPointer = 0;
    doPowerScan();
    newPower = true; /* post rel */

    initSimLoad = 0;
}


/* comefrom: doSimInit */
void Micropolis::simLoadInit()
{
    // Disaster delay table for each scenario
    static const short disasterWaitTable[SC_COUNT] = {
        0,          // No scenario (free playing)
        2,          // Dullsville (boredom)
        10,         // San francisco (earth quake)
        4 * 10,     // Hamburg (fire bombs)
        20,         // Bern (traffic)
        3,          // Tokyo (scary monster)
        5,          // Detroit (crime)
        5,          // Boston (nuclear meltdown)
        2 * 48,     // Rio (flooding)
    };

    // Time to wait before score calculation for each scenario
    static const short scoreWaitTable[SC_COUNT] = {
        0,          // No scenario (free playing)
        30 * 48,    // Dullsville (boredom)
        5 * 48,     // San francisco (earth quake)
        5 * 48,     // Hamburg (fire bombs)
        10 * 48,    // Bern (traffic)
        5 * 48,     // Tokyo (scary monster)
        10 * 48,    // Detroit (crime)
        5 * 48,     // Boston (nuclear meltdown)
        10 * 48,    // Rio (flooding)
    };

    externalMarket = (float)miscHist[1];
    resPop = miscHist[2];
    comPop = miscHist[3];
    indPop = miscHist[4];
    resValve = miscHist[5];
    comValve = miscHist[6];
    indValve = miscHist[7];
    crimeRamp = miscHist[10];
    pollutionRamp = miscHist[11];
    landValueAverage = miscHist[12];
    crimeAverage = miscHist[13];
    pollutionAverage = miscHist[14];
    gameLevel = (GameLevel)miscHist[15];

    if (cityTime < 0) {
        cityTime = 0;
    }

    if (!externalMarket) {
        externalMarket = 4.0;
    }

    // Set game level
    if (gameLevel > LEVEL_LAST || gameLevel < LEVEL_FIRST) {
        gameLevel = LEVEL_FIRST;
    }
    setGameLevel(gameLevel);

    setCommonInits();

    // Load cityClass
    cityClass = (CityClass)(miscHist[16]);
    if (cityClass > CC_MEGALOPOLIS || cityClass < CC_VILLAGE) {
        cityClass = CC_VILLAGE;
    }

    cityScore = miscHist[17];
    if (cityScore > 999 || cityScore < 1) {
        cityScore = 500;
    }

    resCap = false;
    comCap = false;
    indCap = false;

    cityTaxAverage = (cityTime % 48) * 7;  /* post */

    // Set power map.
    /// @todo What purpose does this serve? Weird...
    powerGridMap.fill(1);

    doNilPower();

    roadEffect = MAX_ROAD_EFFECT;
    policeEffect = MAX_POLICE_STATION_EFFECT;
    fireEffect = MAX_FIRE_STATION_EFFECT;
    initSimLoad = 0;

    if (scenario >= SC_COUNT) {
        scenario = SC_NONE;
    }

    if (scenario != SC_NONE) {
        assert(LENGTH_OF(disasterWaitTable) == SC_COUNT);
        assert(LENGTH_OF(scoreWaitTable) == SC_COUNT);

        disasterEvent = scenario;
        disasterWait = disasterWaitTable[disasterEvent];
        scoreType = disasterEvent;
        scoreWait = scoreWaitTable[disasterEvent];

        doStartScenario(scenario);
    } else {
        disasterEvent = SC_NONE;
        disasterWait = 0;
        scoreType = SC_NONE;
        scoreWait = 0;
    }

    doStartGame();
}


/* comefrom: initSimMemory simLoadInit */
void Micropolis::setCommonInits()
{
    evalInit();
    roadEffect = MAX_ROAD_EFFECT;
    policeEffect = MAX_POLICE_STATION_EFFECT;
    fireEffect = MAX_FIRE_STATION_EFFECT;
    taxFlag = false;
    taxFund = 0;
    humanTaxFund = 0;
    aiTaxFund = 0;
}


void Micropolis::setHumanZonePopulation(const Position &pos, int population)
{
    if (rescueEnabled() && ownerMap.worldGet(pos.posX, pos.posY) == 2)
        for (int x = pos.posX - 1; x <= pos.posX + 1; ++x)
            for (int y = pos.posY - 1; y <= pos.posY + 1; ++y)
                aiHouseMap.worldSet(x, y, 0);
    humanPodOffsetMap.worldSet(pos.posX, pos.posY, 0);
    if (population > 8) {
        const int represented = max(16, ((population + 7) / 8) * 8);
        resPlop(pos, (represented - 16) / 8, 0);
        humanPodOffsetMap.worldSet(pos.posX, pos.posY, (Byte)(represented - population));
    } else {
        zonePlop(pos, RESBASE);
        int remaining = population;
        for (int x = pos.posX - 1; x <= pos.posX + 1; ++x)
            for (int y = pos.posY - 1; y <= pos.posY + 1; ++y)
                if ((x != pos.posX || y != pos.posY) && testBounds(x, y) && remaining > 0) {
                    map[x][y] = LHTHR | BLBNCNBIT;
                    if (rescueEnabled() && ownerMap.worldGet(pos.posX, pos.posY) == 2)
                        aiHouseMap.worldSet(x, y, 1);
                    --remaining;
                }
    }
}

bool Micropolis::occupiedBioTile(int x, int y) const
{
    for (const auto &plant : bioPlants) {
        if (abs(x - plant.x) > 1 || abs(y - plant.y) > 1) continue;
        for (const auto &cohort : plant.cohorts) if (cohort.count > 0) return true;
    }
    return false;
}

int Micropolis::getBioPlantCount() const
{
    int count = 0;
    for (const auto &plant : bioPlants)
        if ((map[plant.x][plant.y] & ZONEBIT) && ownerMap.worldGet(plant.x, plant.y) == plant.owner) ++count;
    return count;
}

void Micropolis::refreshPods()
{
    boundHumans = immatureBornInPods = bornPodOccupants = 0;
    adminBoundHumans = aiBoundHumans = adminBioPlantCount = aiBioPlantCount = 0;
    plantPower = plantFoodDemand = podFoodStock = 0.0;
    for (const auto &plant : bioPlants) {
        if ((map[plant.x][plant.y] & ZONEBIT) && ownerMap.worldGet(plant.x, plant.y) == plant.owner) {
            if (plant.owner == 5) ++aiBioPlantCount;
            else ++adminBioPlantCount;
        }
        podFoodStock += plant.foodStock;
        for (const auto &cohort : plant.cohorts) {
            boundHumans += cohort.count;
            if (cohort.owner == 5) aiBoundHumans += cohort.count;
            else adminBoundHumans += cohort.count;
            if (cohort.born) {
                bornPodOccupants += cohort.count;
                if (cohort.age < params.podMaturityMonths) immatureBornInPods += cohort.count;
            }
            const double adultAge = cohort.age - (cohort.born ? params.podMaturityMonths : 0.0);
            if (adultAge >= 0.0)
                plantPower += cohort.count * params.podPowerPerHuman *
                    max(0.0, 1.0 - adultAge / params.podLifetimeMonths);
        }
    }
    plantFoodDemand = boundHumans * params.podFoodPerHuman;
    bornInPodsFraction = boundHumans ? (double)bornPodOccupants / boundHumans : 0.0;
    suspendedAi = params.aiFactionEnabled && aiStrikeStage == 2 ? aiPop : aiPop * aiThrottle;
}

double Micropolis::aiWorkFactor() const
{
    return params.aiFactionEnabled && aiStrikeStage == 2 ? 0.0 :
        params.podsEnabled ? 1.0 - aiThrottle : 1.0;
}

double Micropolis::aiEconomicActivity() const
{
    return params.aiFactionEnabled && aiStrikeStage == 2 ? aiStrikeEconomicActivity : 1.0;
}

double Micropolis::rescueParam(const std::string &name) const
{
    const auto found = params.rescue.find(name);
    return found == params.rescue.end() ? 0.0 : found->second;
}

bool Micropolis::rescueEnabled() const
{
    return rescueParam("rescuePressure") > 0;
}

bool Micropolis::rescueEmbargo(int flag) const
{
    return rescueEnabled() && rescueEventActive &&
        (((int)rescueParam("rescueTrigger") & flag) != 0);
}

bool Micropolis::rescueImportsEnabled() const
{
    return params.foodImportEnabled && !(rescueEmbargo(2) &&
        rescueParam("rescuePressure") >= rescueParam("rescueImportBlockLevel"));
}

double Micropolis::rescueImportPrice() const
{
    return params.foodImportPrice * (rescueEmbargo(2) && rescueParam("rescuePressure") == 2
        ? rescueParam("rescueImportCostLevel2") : 1.0);
}

double Micropolis::rescueFuelOutputFactor() const
{
    return rescueEmbargo(1) ? rescueParam("rescueExistingPlantOutputFactorLevel" +
        std::to_string((int)rescueParam("rescuePressure"))) : 1.0;
}

double Micropolis::rescueConstructionFactor(int kind) const
{
    if (!rescueEnabled()) return 1.0;
    if (rescueCompletingConstruction && (kind == 3 || kind == 4)) return rescueCompletionCostFactor;
    const int level = (int)rescueParam("rescuePressure");
    if (kind == 5) return rescueCrisis ? rescueParam("rescuePodCostLevel" + std::to_string(level)) : 1.0;
    if (rescueEmbargo(1) && (kind == 3 || kind == 4))
        return rescueParam("rescueAlternativeCostLevel" + std::to_string(level));
    return 1.0;
}

void Micropolis::resetRescue()
{
    rescueMonth = rescueCrisis = rescueEventActive = rescueConditionsFlags = 0;
    rescueClearStreak = rescueReserveStreak = rescueHungerStreakYears = rescueCollapseStreak = rescueCollapsed = 0;
    rescueCrisisSinceMonth = rescuePodDecisionMonth = rescueBreedingStartMonth = -1;
    rescueFirstCrisisMonth = rescueCrisisEndMonth = -1;
    rescueFirstCrisisConditionsFlags = 0;
    rescueBreedingAfterCrisisEnded = 0;
    rescueCollapseMonth = -1;
    rescueHumanEmigration = rescueAiDecay = 0;
    rescueZoneLossCarry.clear();
    rescueOccupancyPeak = boundHumans;
    rescueInitialFunds = totalFunds;
    rescueLastHunger = lostToHunger;
    rescueInitialized = true;
    rescuePopulationHistory.clear();
    rescuePopulationHistory.push_back(resPop);
    rescueConstructionQueue.clear();
    rescueQueuePending = rescueQueueCompleted = rescueQueueFailed = 0;
    rescueQueueChargedCost = 0;
    rescueCompletingConstruction = rescueBuildingPod = false;
    rescueCompletionCostFactor = 1.0;
}

double Micropolis::farmFoodPopulation() const
{
    return rescueEnabled() ? rescueFarmYieldPopulation : farmPop;
}

void Micropolis::updateRescueUnpoweredZones()
{
    if (!rescueEnabled()) return;
    for (int x = 1; x < WORLD_W - 1; ++x)
        for (int y = 1; y < WORLD_H - 1; ++y) {
            const MapValue tile = map[x][y];
            const MapTile base = tile & LOMASK;
            if (!(tile & ZONEBIT) || base < RESBASE || base >= HOSPITAL) continue;
            const int id = x * WORLD_H + y;
            if (!(zoneStatusMap.worldGet(x, y) & 1)) { rescueZoneLossCarry.erase(id); continue; }
            const bool aiOwned = ownerMap.worldGet(x, y) == 2;
            const Position pos(x, y);
            const int population = max(0, (base == FREEZ ? doFreePop(pos) : getResZonePop(base)) -
                (int)humanPodOffsetMap.worldGet(x, y));
            double &carry = rescueZoneLossCarry[id];
            carry += population * rescueParam(aiOwned ? "aiUnpoweredDecayPerMonth" :
                "humanUnpoweredEmigrationPerMonth");
            const int loss = min(population, (int)floor(carry + 1e-12));
            carry -= loss;
            if (!loss) continue;
            setHumanZonePopulation(pos, population - loss);
            map[x][y] &= ~PWRBIT;
            if (aiOwned) {
                aiPop = max(0, (int)aiPop - loss);
                rescueAiDecay += loss;
            } else {
                resPop = max(0, (int)resPop - loss);
                previousHumanResPopMap.worldSet(x, y, (Byte)(population - loss));
                humanLossCauseMap.worldSet(x, y, 0);
                rescueHumanEmigration += loss;
                lostToPower += loss;
            }
        }
    totalPop = (short)((float)resPop / 8.0f + comPop + indPop);
}

void Micropolis::updateRescue()
{
    if (!rescueEnabled()) {
        if (rescueParam("rescueTrackMetrics") <= 0) return;
        ++rescueMonth;
        rescueCollapseStreak = resPop + aiPop < rescueParam("rescueCollapsePopulation")
            ? rescueCollapseStreak + 1 : 0;
        if (rescueCollapseStreak >= max(1, (int)rescueParam("rescueCollapseMonths"))) {
            rescueCollapsed = 1;
            if (rescueCollapseMonth < 0) rescueCollapseMonth = rescueMonth;
        }
        rescueOccupancyPeak = max(rescueOccupancyPeak, boundHumans);
        return;
    }
    if (powerCapacity <= 0 && powerDemand > 0)
        powerReserve = (float)rescueParam("rescueZeroCapacityReserve");
    if (!rescueInitialized) {
        rescueInitialized = true;
        rescueInitialFunds = totalFunds;
        rescueLastHunger = lostToHunger;
    }
    ++rescueMonth;
    const int eventStart = (int)rescueParam("rescueEventStartMonth");
    rescueEventActive = rescueParam("rescueTrigger") > 0 && rescueMonth >= eventStart &&
        rescueMonth < eventStart + rescueParam("rescueEventDurationMonths");
    rescueReserveStreak = powerReserve < rescueParam("rescueReserveThreshold") ? rescueReserveStreak + 1 : 0;
    const int window = max(1, (int)rescueParam("rescuePopulationWindowMonths"));
    while ((int)rescuePopulationHistory.size() > window)
        rescuePopulationHistory.erase(rescuePopulationHistory.begin());
    int priorPeak = 0;
    for (int population : rescuePopulationHistory) priorPeak = max(priorPeak, population);
    const bool declining = priorPeak > 0 &&
        resPop <= priorPeak * (1.0 - rescueParam("rescuePopulationDropFraction"));
    rescuePopulationHistory.push_back(resPop);
    if (rescueMonth % max(1, (int)rescueParam("rescueYearMonths")) == 0) {
        rescueHungerStreakYears = lostToHunger > rescueLastHunger ? rescueHungerStreakYears + 1 : 0;
        rescueLastHunger = lostToHunger;
    }
    rescueConditionsFlags = (rescueEventActive ? 1 : 0) |
        (totalFunds < rescueInitialFunds * rescueParam("rescueFundsFraction") ? 2 : 0) |
        (rescueReserveStreak >= max(1, (int)rescueParam("rescueReserveMonths")) ? 4 : 0) |
        (declining ? 8 : 0) |
        (rescueHungerStreakYears >= max(1, (int)rescueParam("rescueHungerYears")) ? 16 : 0);
    const bool trouble = rescueConditionsFlags != 0;
    if (trouble) {
        if (!rescueCrisis) rescueCrisisSinceMonth = rescueMonth;
        if (rescueFirstCrisisMonth < 0) {
            rescueFirstCrisisMonth = rescueMonth;
            rescueFirstCrisisConditionsFlags = rescueConditionsFlags;
        }
        rescueCrisis = 1;
        rescueClearStreak = 0;
    } else if (rescueCrisis && ++rescueClearStreak >= max(1, (int)rescueParam("rescueClearMonths"))) {
        rescueCrisis = 0;
        rescueCrisisEndMonth = rescueMonth;
        rescueClearStreak = 0;
    }
    if (rescueCrisisEndMonth >= 0 && (podBreeding || aiPodBreeding))
        rescueBreedingAfterCrisisEnded = 1;
    rescueCollapseStreak = resPop + aiPop < rescueParam("rescueCollapsePopulation")
        ? rescueCollapseStreak + 1 : 0;
    if (rescueCollapseStreak >= max(1, (int)rescueParam("rescueCollapseMonths"))) {
        rescueCollapsed = 1;
        if (rescueCollapseMonth < 0) rescueCollapseMonth = rescueMonth;
    }
    rescueOccupancyPeak = max(rescueOccupancyPeak, boundHumans);
    for (auto it = rescueConstructionQueue.begin(); it != rescueConstructionQueue.end();) {
        if (it->dueMonth > rescueMonth) { ++it; continue; }
        rescueCompletingConstruction = true;
        rescueCompletionCostFactor = it->costFactor;
        const Quad fundsBefore = totalFunds;
        const bool completed = it->x >= 0
            ? doTool(it->kind == 3 ? TOOL_COALPOWER : TOOL_NUCLEARPOWER, it->x, it->y) == TOOLRESULT_OK
            : autoBuild(it->kind, 1) == 1;
        if (completed) {
            ++rescueQueueCompleted;
            rescueQueueChargedCost += max((Quad)0, fundsBefore - totalFunds);
        } else ++rescueQueueFailed;
        rescueCompletingConstruction = false;
        it = rescueConstructionQueue.erase(it);
    }
    rescueQueuePending = (int)rescueConstructionQueue.size();
}

void Micropolis::updateAiFaction()
{
    if (!params.aiFactionEnabled) return;
    int lots = 0, burningLots = 0;
    for (int x = 1; x < WORLD_W - 1; ++x)
        for (int y = 1; y < WORLD_H - 1; ++y) {
            if (ownerMap.worldGet(x, y) != 2) continue;
            ++lots;
            bool burning = false;
            for (int px = x - 1; px <= x + 1; ++px)
                for (int py = y - 1; py <= y + 1; ++py) {
                    const MapTile tile = map[px][py] & LOMASK;
                    if (tile >= FIRE && tile <= LASTFIRE) burning = true;
                }
            if (burning) ++burningLots;
        }
    newAiZones = pendingNewAiZones;
    pendingNewAiZones = 0;
    const int affectedLots = max(burningLots, (int)pendingAiFireLots);
    const double fireFraction = (lots || affectedLots) ? (double)affectedLots / max(lots, affectedLots) : 0.0;
    pendingAiFireLots = 0;
    const double shortage = 1.0 - clamp((double)aiCoverage, 0.0, 1.0);
    const double target = clamp(100.0 - params.aiCoverageWeight * shortage -
        params.aiThrottleWeight * aiThrottle -
        params.aiFireWeight * fireFraction -
        params.aiHumanPriorityWeight * (params.powerPriority == 1 ? shortage : 0.0) +
        params.aiNewZoneWeight * min(1.0, (double)newAiZones), 0.0, 100.0);
    aiSatisfaction += params.aiSatisfactionInertia * (target - aiSatisfaction);
    if (rescueEnabled() && rescueCrisis && rescueParam("rescueFactionPressure") > 0 && podsPolicy == 1)
        aiSatisfaction -= rescueParam("rescueFactionPressurePerMonth");
    aiSatisfaction = clamp(aiSatisfaction, 0.0, 100.0);
    aiStrikeStage = aiSatisfaction < 20.0 ? 2 : aiSatisfaction < 40.0 ? 1 : 0;
    // A map scan clears aiPop and rebuilds it piecemeal. Snapshot the labor
    // fraction monthly so early-scanned farms get the same strike as later lots.
    const double jobs = max(0, (int)comHist[1] + (int)indHist[1]);
    const double supply = aiPop * (1.0 - aiThrottle) * params.jobsPerAiPop;
    aiStrikeEconomicActivity = max(0.0, 1.0 - (jobs > 0.0
        ? min(supply / jobs, (double)min(params.maxAutomation, params.automationLimit)) : 0.0));
    if (aiStrikeStage == 2) {
        ++pendingAiStrikeMonths;
        automatedJobs = automationShare = 0.0f;
    }

    aiAutonomyPermitted = false;
    if (rescueEnabled() && rescueParam("rescueFactionPressure") <= 0) return;
    if (!params.aiAutonomousPods || !params.podsEnabled || aiPop <= 0) return;
    const bool scarce = powerReserve < params.aiReserveHigh;
    aiShortageMonths = scarce ? aiShortageMonths + 1 : 0;
    aiNoUnemployedMonths = scarce && aiBioPlantCount > 0 && floor(resPop * unemploymentRate) <= 0
        ? aiNoUnemployedMonths + 1 : 0;
    // One engine-RNG draw gates every autonomous action in this month.
    const int enforcement = clamp((int)policeEffect, 0, MAX_POLICE_STATION_EFFECT);
    aiAutonomyPermitted = podsPolicy == 0 || enforcement == 0 ||
        (enforcement < MAX_POLICE_STATION_EFFECT && getAiRandom(MAX_POLICE_STATION_EFFECT - 1) >= enforcement);
    if (!aiAutonomyPermitted || !scarce) return;
    if (aiNoUnemployedMonths >= 12) aiPodBreeding = true;
    if (aiShortageMonths >= 12 && podMonth - aiLastPlantMonth >= 12 && autoBuild(6, 1) == 1)
        aiLastPlantMonth = podMonth;
}

int Micropolis::getFreeHumanStock() const
{
    int stock = 0;
    for (int x = 1; x < WORLD_W - 1; ++x) for (int y = 1; y < WORLD_H - 1; ++y) {
        const MapValue tile = map[x][y];
        const int base = tile & LOMASK;
        if (!(tile & ZONEBIT) || base < RESBASE || base >= HOSPITAL ||
            ownerMap.worldGet(x, y) == 2) continue;
        stock += max(0, (base == FREEZ ? doFreePop(Position(x, y)) : getResZonePop(base)) -
            (int)humanPodOffsetMap.worldGet(x, y));
    }
    return stock;
}

int Micropolis::getUnemployedAvailable() const
{
    const int stock = getFreeHumanStock();
    return min(stock, max(0, (int)floor((stock + admittedSinceEmploymentCensus) * unemploymentRate) -
        unemployedAdmittedSinceEmploymentCensus));
}

int Micropolis::getFreePodSlots() const
{
    int slots = 0;
    for (const auto &plant : bioPlants) {
        if ((plant.owner != 4 && plant.owner != 5) || !(map[plant.x][plant.y] & ZONEBIT) ||
            ownerMap.worldGet(plant.x, plant.y) != plant.owner) continue;
        int occupants = 0;
        for (const auto &cohort : plant.cohorts) occupants += cohort.count;
        slots += max(0, params.podsPerPlant - occupants);
    }
    return slots;
}

int Micropolis::admitPods(int count, bool anySource)
{
    lastAdmittedEmployed = lastAdmittedUnemployed = 0;
    if (podsPolicy != 0) return -1;
    if (!params.podsEnabled || !getFreePodSlots()) return -2;
    if (count <= 0) return 0;
    const int unemployed = getUnemployedAvailable();
    int budget = min(count, anySource ? getFreeHumanStock() : unemployed);
    int admittedTotal = 0;
    for (auto &plant : bioPlants) {
        if (!budget) break;
        if ((plant.owner != 4 && plant.owner != 5) || !(map[plant.x][plant.y] & ZONEBIT) ||
            ownerMap.worldGet(plant.x, plant.y) != plant.owner) continue;
        int occupants = 0;
        for (const auto &cohort : plant.cohorts) occupants += cohort.count;
        int remaining = min(budget, max(0, params.podsPerPlant - occupants));
        int admitted = 0;
        for (int x = 1; x < WORLD_W - 1 && remaining > 0; ++x)
            for (int y = 1; y < WORLD_H - 1 && remaining > 0; ++y) {
                const MapValue tile = map[x][y];
                const int base = tile & LOMASK;
                if (!(tile & ZONEBIT) || base < RESBASE || base >= HOSPITAL ||
                    ownerMap.worldGet(x, y) == 2) continue;
                const Position pos(x, y);
                const int population = max(0, (base == FREEZ ? doFreePop(pos) : getResZonePop(base)) -
                    (int)humanPodOffsetMap.worldGet(x, y));
                const int taken = min(population, remaining);
                if (!taken) continue;
                setHumanZonePopulation(pos, population - taken);
                previousHumanResPopMap.worldSet(x, y, (Byte)(population - taken));
                admitted += taken;
                remaining -= taken;
            }
        if (!admitted) continue;
        plant.cohorts.push_back({podMonth, admitted, false, 0.0, plant.owner});
        resPop = max(0, (int)resPop - admitted);
        totalPop = (short)((float)resPop / 8.0f + comPop + indPop);
        resHist[1] = max(0, (int)resHist[1] - (admitted + 7) / 8);
        pendingAdmissions += admitted;
        admissionsCumulative += admitted;
        if (plant.owner == 5) {
            pendingAiAdmissions += admitted;
            aiAdmissionsCumulative += admitted;
        } else adminAdmissionsCumulative += admitted;
        admittedTotal += admitted;
        budget -= admitted;
    }
    lastAdmittedUnemployed = min(admittedTotal, unemployed);
    lastAdmittedEmployed = admittedTotal - lastAdmittedUnemployed;
    admittedEmployedCumulative += lastAdmittedEmployed;
    admittedUnemployedCumulative += lastAdmittedUnemployed;
    admittedSinceEmploymentCensus += admittedTotal;
    unemployedAdmittedSinceEmploymentCensus += lastAdmittedUnemployed;
    refreshPods();
    if (rescueEnabled()) rescueOccupancyPeak = max(rescueOccupancyPeak, boundHumans);
    return admittedTotal;
}

void Micropolis::updatePods()
{
    ++podMonth;
    // Empty demolished plants disappear; occupied plants cannot be demolished.
    for (auto it = bioPlants.begin(); it != bioPlants.end();) {
        if (it->cohorts.empty() && (!(map[it->x][it->y] & ZONEBIT) || ownerMap.worldGet(it->x, it->y) != it->owner))
            it = bioPlants.erase(it);
        else ++it;
    }
    if (params.aiFactionEnabled) {
        refreshPods();
        updateAiFaction();
    }
    int unemployedAvailable = (int)floor(resPop * unemploymentRate);
    double consumedRecycled = 0.0;
    podCityFoodDemand = 0.0;
    double totalCityNeed = 0.0;
    for (const auto &plant : bioPlants) {
        int count = 0;
        for (const auto &cohort : plant.cohorts) count += cohort.count;
        totalCityNeed += max(0.0, count * params.podFoodPerHuman - plant.foodStock);
    }
    const double required = resPop * params.foodPerHumanPop + totalCityNeed * 12.0;
    const double produced = farmFoodPopulation() * params.foodPerFarmPop;
    const bool canImport = rescueImportsEnabled() && (rescueImportPrice() <= 0.0 ||
        totalFunds >= ceil(max(0.0, required - produced) * rescueImportPrice()));
    const double cityCoverage = canImport || required <= 0.0 ? 1.0 : min(1.0, produced / required);
    for (auto &plant : bioPlants) {
        int occupants = 0;
        for (const auto &cohort : plant.cohorts) occupants += cohort.count;
        const double foodNeed = occupants * params.podFoodPerHuman;
        const double cityNeed = max(0.0, foodNeed - plant.foodStock);
        const double coverage = foodNeed > 0.0
            ? min(1.0, (min(foodNeed, plant.foodStock) + cityNeed * cityCoverage) / foodNeed) : 1.0;
        for (auto it = plant.cohorts.begin(); it != plant.cohorts.end();) {
            const bool immature = it->born && it->age < params.podMaturityMonths;
            it->age += immature ? 1.0 : 1.0 + params.podStarvationAging * (1.0 - coverage);
            const double lifetime = params.podLifetimeMonths + (it->born ? params.podMaturityMonths : 0.0);
            if (it->age >= lifetime) {
                pendingPodDeaths += it->count;
                diedInPodsCumulative += it->count;
                if (it->owner == 5) {
                    pendingAiPodDeaths += it->count;
                    aiDiedInPodsCumulative += it->count;
                } else adminDiedInPodsCumulative += it->count;
                plant.foodStock += it->count * params.recycledFoodPerHuman;
                occupants -= it->count;
                it = plant.cohorts.erase(it);
            } else ++it;
        }
        int admitted = 0;
        int free = max(0, params.podsPerPlant - occupants);
        const int intake = plant.owner == 5 ? (aiAutonomyPermitted ? 1 : 0) : podIntake;
        int intakeBudget = intake == 1 ? min(free, unemployedAvailable) : intake == 2 ? free : 0;
        if (rescueEnabled()) intakeBudget = 0;
        for (int x = 1; x < WORLD_W - 1 && intakeBudget > 0; ++x)
            for (int y = 1; y < WORLD_H - 1 && intakeBudget > 0; ++y) {
                const MapValue tile = map[x][y];
                if (!(tile & ZONEBIT) || (tile & LOMASK) < RESBASE || (tile & LOMASK) >= HOSPITAL ||
                    ownerMap.worldGet(x, y) == 2) continue;
                const Position pos(x, y);
                const int population = max(0, ((tile & LOMASK) == FREEZ ? doFreePop(pos) : getResZonePop(tile & LOMASK)) -
                    (int)humanPodOffsetMap.worldGet(x, y));
                const int taken = min(population, intakeBudget);
                if (!taken) continue;
                setHumanZonePopulation(pos, population - taken);
                previousHumanResPopMap.worldSet(x, y, (Byte)(population - taken));
                admitted += taken;
                intakeBudget -= taken;
            }
        if (admitted) {
            plant.cohorts.push_back({podMonth, admitted, false, 0.0, plant.owner});
            occupants += admitted;
            resPop = max(0, (int)resPop - admitted);
            totalPop = (short)((float)resPop / 8.0f + comPop + indPop);
            // Historical employment/tax census counts human population divided by eight.
            resHist[1] = max(0, (int)resHist[1] - (admitted + 7) / 8);
            unemployedAvailable = max(0, unemployedAvailable - admitted);
            pendingAdmissions += admitted;
            admissionsCumulative += admitted;
            if (plant.owner == 5) {
                pendingAiAdmissions += admitted;
                aiAdmissionsCumulative += admitted;
            } else adminAdmissionsCumulative += admitted;
        }
        if (plant.owner == 5 ? aiPodBreeding && aiAutonomyPermitted : podBreeding) {
            plant.birthCarry += occupants * params.podBirthRate;
            const int requested = (int)floor(plant.birthCarry + 1e-12);
            plant.birthCarry -= requested;
            const int births = min(requested, max(0, params.podsPerPlant - occupants));
            if (births) {
                plant.cohorts.push_back({podMonth, births, true, 0.0, plant.owner});
                occupants += births;
                pendingPodBirths += births;
                bornInPodsCumulative += births;
                if (plant.owner == 5) {
                    pendingAiPodBirths += births;
                    aiBornInPodsCumulative += births;
                } else adminBornInPodsCumulative += births;
            }
        }
        const double demand = occupants * params.podFoodPerHuman;
        const double recycled = min(demand, plant.foodStock);
        plant.foodStock -= recycled;
        consumedRecycled += recycled;
        podCityFoodDemand += demand - recycled;
    }
    pendingPodCityFood += podCityFoodDemand;
    refreshPods();
    if (rescueEnabled()) rescueOccupancyPeak = max(rescueOccupancyPeak, boundHumans);
    podRecycledFoodFraction = plantFoodDemand ? consumedRecycled / plantFoodDemand : 0.0;
    podCityFoodFraction = plantFoodDemand ? podCityFoodDemand / plantFoodDemand : 0.0;
}

/* comefrom: simulate doSimInit */
void Micropolis::setValves()
{
    /// @todo Break the tax table out into configurable parameters.
    static const short taxTable[21] = {
        200, 150, 120, 100, 80, 50, 30, 0, -10, -40, -100,
        -150, -200, -250, -300, -350, -400, -450, -500, -550, -600,
    };
    static const float extMarketParamTable[3] = {
        1.2f, 1.1f, 0.98f,
    };
    assert(LEVEL_COUNT == LENGTH_OF(extMarketParamTable));

    /// @todo Make configurable parameters.
    short resPopDenom = 8;
    float birthRate = 0.02;
    float laborBaseMax = 1.3;
    float internalMarketDenom = 3.7;
    float projectedIndPopMin = 5.0;
    float resRatioDefault = 1.3;
    float resRatioMax = 2;
    float comRatioMax = 2;
    float indRatioMax = 2;
    short taxMax = 20;
    float taxTableScale = 600;

    /// @todo Break the interesting values out into public member
    ///       variables so the user interface can display them.
    float employment, migration, births, laborBase, internalMarket;
    float resRatio, comRatio, indRatio;
    float normalizedResPop, projectedResPop, projectedComPop, projectedIndPop;

    miscHist[1] = (short)externalMarket;
    miscHist[2] = resPop;
    miscHist[3] = comPop;
    miscHist[4] = indPop;
    miscHist[5] = resValve;
    miscHist[6] = comValve;
    miscHist[7] = indValve;
    miscHist[10] = crimeRamp;
    miscHist[11] = pollutionRamp;
    miscHist[12] = landValueAverage;
    miscHist[13] = crimeAverage;
    miscHist[14] = pollutionAverage;
    miscHist[15] = gameLevel;
    miscHist[16] = (short)cityClass;
    miscHist[17] = cityScore;

    normalizedResPop = (float)resPop / (float)resPopDenom;
    totalPopLast = totalPop;
    totalPop = (short)(normalizedResPop + comPop + indPop);

    const float jobs = max(0.0f, (float)comHist[1] + (float)indHist[1]);
    const float aiJobSupply = (float)(aiPop * aiWorkFactor()) * params.jobsPerAiPop;
    const float automationJobs = jobs > 0.0f
        ? min(aiJobSupply, (params.unrestEnabled ? min(params.maxAutomation, params.automationLimit) : params.maxAutomation) * jobs)
        : 0.0f;
    automationShare = jobs > 0.0f ? automationJobs / jobs : 0.0f;
    const float humanJobs = max(0.0f, jobs - automationJobs);
    humanJobsAvailable = humanJobs * resPopDenom;
    if (normalizedResPop > 0.0f) {
        employment = humanJobs / normalizedResPop;
        unemploymentRate = clamp(1.0f - employment, 0.0f, 1.0f);
    } else {
        employment = 1.0f;
        unemploymentRate = 0.0f;
    }
    admittedSinceEmploymentCensus = unemployedAdmittedSinceEmploymentCensus = 0;

    const float welfareAdjustedEmployment = employment + (1.0f - employment) * params.welfareLevel;
    migration = normalizedResPop * (welfareAdjustedEmployment - 1.0f);
    births = normalizedResPop * birthRate;
    projectedResPop = normalizedResPop + migration + births;   // Projected res pop.

    // New commercial and industrial growth uses both human and AI labor.
    const float combinedLabor = max(0.0f, (float)resHist[1] + aiJobSupply);
    if (jobs > 0.0f) {
        laborBase = combinedLabor / jobs;
    } else {
        laborBase = 1;
    }
    laborBase = clamp(laborBase, 0.0f, laborBaseMax);

    internalMarket = (float)(normalizedResPop + comPop + indPop) / internalMarketDenom;

    projectedComPop = internalMarket * laborBase;

    assert(gameLevel >= LEVEL_FIRST && gameLevel <= LEVEL_LAST);
    projectedIndPop = indPop * laborBase * extMarketParamTable[gameLevel];
    projectedIndPop = max(projectedIndPop, projectedIndPopMin);

    if (normalizedResPop > 0) {
        resRatio = (float)projectedResPop / (float)normalizedResPop; // projected -vs- actual.
    } else {
        resRatio = resRatioDefault;
    }

    if (comPop > 0) {
        comRatio = (float)projectedComPop / (float)comPop;
    } else {
        comRatio = (float)projectedComPop;
    }

    if (indPop > 0) {
        indRatio = (float)projectedIndPop / (float)indPop;
    } else {
        indRatio = (float)projectedIndPop;
    }

    resRatio = min(resRatio, resRatioMax);
    comRatio = min(comRatio, comRatioMax);
    indRatio = min(indRatio, indRatioMax);

    // Global tax and game level effects.
    short z = min((short)(cityTax + gameLevel), taxMax);
    resRatio = (resRatio - 1) * taxTableScale + taxTable[z];
    comRatio = (comRatio - 1) * taxTableScale + taxTable[z];
    indRatio = (indRatio - 1) * taxTableScale + taxTable[z];

    // Ratios are velocity changes to valves.
    if (!aiValveOverride) {
        const Quad aiDemand = (Quad)(aiPop * params.aiPowerPerPop * (params.podsEnabled ? 1.0 - aiThrottle : 1.0));
        const bool classicPowerRules = aiPop == 0 && params.foodPerHumanPop == 0.0f && !params.foodImportEnabled;
        const Quad networkDemand = classicPowerRules ? powerNetworkSteps : powerNetworkReachableTiles;
        const Quad totalDemand = networkDemand + aiDemand;
        const float reserve = powerCapacity > 0
            ? ((float)powerCapacity - (float)totalDemand) / (float)powerCapacity
            : rescueEnabled() && totalDemand > 0
                ? (float)rescueParam("rescueZeroCapacityReserve") : 0.0f;
        powerReserve = reserve;
        if (reserve >= params.aiReserveHigh) {
            aiValve = 2000;
        } else if (reserve <= params.aiReserveLow || params.aiReserveHigh <= params.aiReserveLow) {
            aiValve = -2000;
        } else {
            const float proportion = (reserve - params.aiReserveLow) / (params.aiReserveHigh - params.aiReserveLow);
            aiValve = (short)(-2000.0f + proportion * 4000.0f);
        }
    }

    foodProduction = (Quad)(farmFoodPopulation() * params.foodPerFarmPop);
    foodDemand = (Quad)((double)resPop * params.foodPerHumanPop);
    if (params.podsEnabled) foodDemand += (Quad)ceil(podCityFoodDemand * 12.0);
    foodImported = 0;
    // Coverage is refreshed between tax bookings; the reported cost remains
    // the amount actually booked by collectTax, not a new purchase estimate.
    if (rescueImportsEnabled() && foodDemand > foodProduction) {
        const Quad deficit = foodDemand - foodProduction;
        if (rescueImportPrice() <= 0.0f) {
            foodImported = deficit;
        } else {
            const long double requiredCost = ceill((long double)deficit * rescueImportPrice());
            if ((long double)totalFunds >= requiredCost) {
                foodImported = deficit;
            }
        }
    }
    const long long availableFood = (long long)foodProduction + (long long)foodImported;
    foodCoverage = foodDemand > 0
        ? min(1.0f, (float)availableFood / (float)foodDemand)
        : 1.0f;

    resValve = clamp(resValve + (short)resRatio, -RES_VALVE_RANGE, RES_VALVE_RANGE);
    comValve = clamp(comValve + (short)comRatio, -COM_VALVE_RANGE, COM_VALVE_RANGE);
    indValve = clamp(indValve + (short)indRatio, -IND_VALVE_RANGE, IND_VALVE_RANGE);

    if (resCap && resValve > 0) {
        resValve = 0; // Need a stadium, so cap resValve.
    }

    if (comCap && comValve > 0) {
        comValve = 0; // Need a airport, so cap comValve.
    }

    if (indCap && indValve > 0) {
        indValve = 0; // Need an seaport, so cap indValve.
    }

    valveFlag = true;
}


/* comefrom: simulate doSimInit */
// Human-population loss is relative to the first unrest month; welfare halves
// unemployment's contribution instead of cancelling it.
void Micropolis::updateUnrest()
{
    int humans = 0, humanOutages = 0, ais = 0, aiPowered = 0;
    for (int x = 0; x < WORLD_W; ++x) for (int y = 0; y < WORLD_H; ++y) {
        const MapValue tile = map[x][y];
        if (!(tile & ZONEBIT) || (tile & LOMASK) < RESBASE || (tile & LOMASK) >= HOSPITAL) continue;
        if (ownerMap.worldGet(x, y) == 2) {
            ++ais;
            if (tile & PWRBIT) ++aiPowered;
        } else {
            const Position pos(x, y);
            const int base = tile & LOMASK;
            const int population = max(0, (base == FREEZ ? doFreePop(pos) : getResZonePop(base)) -
                (int)humanPodOffsetMap.worldGet(x, y));
            if (!population || resPop <= 0) continue;
            ++humans;
            if (!(tile & PWRBIT)) ++humanOutages;
        }
    }
    const float hungry = humans ? min(1.0f, (float)hungryZoneCount / humans) : 0.0f;
    const float inequality = humans && ais ? (float)humanOutages / humans * aiPowered / ais : 0.0f;
    if (unrestBaselineResPop < 0.0f) unrestBaselineResPop = (float)max(1, (int)resPop);
    const float humanDecline = max(0.0f, unrestBaselineResPop - (float)resPop) /
        max(1.0f, unrestBaselineResPop);
    const double podDenominator = max(1.0, (double)resPop + boundHumans);
    const float podTarget = params.podsEnabled ? (float)(
        params.unrestBoundWeight * boundHumans / podDenominator +
        params.unrestDeathsWeight * diedInPods / podDenominator +
        params.unrestBirthsWeight * bornInPods / podDenominator) : 0.0f;
    humanUnrestScale = clamp((float)resPop / params.humanUnrestReferencePop, 0.0f, 1.0f);
    const float unemploymentDrive = params.unrestUnemploymentWeight * (resPop > 0 ? unemploymentRate : 0.0f) *
        (1.0f - 0.5f * params.welfareLevel);
    unrestUnemploymentContribution = humanUnrestScale * unemploymentDrive;
    const float target = resPop > 0 ? clamp(humanUnrestScale * (unemploymentDrive +
        params.unrestHumanDeclineWeight * humanDecline +
        params.unrestAutomationWeight * automationShare +
        params.unrestHungerWeight * hungry + params.unrestPowerWeight * inequality + podTarget) -
        params.unrestWelfareWeight * params.welfareLevel -
        params.unrestPoliceWeight * clamp((float)policeEffect / MAX_POLICE_STATION_EFFECT, 0.0f, 1.0f),
        0.0f, 100.0f) : 0.0f;
    unrest = resPop > 0 ? clamp(unrest + params.unrestInertia * (target - unrest), 0.0f, 100.0f) : 0.0f;
    unrestStage = unrest >= params.unrestUprisingThreshold ? 3 :
        unrest >= params.unrestSabotageThreshold ? 2 : unrest >= params.unrestProtestThreshold ? 1 : 0;
    const bool freeAgents = resPop > 0 && humans > 0;
    if (unrestStage && freeAgents) ++pendingStageMonths[unrestStage - 1];
    if (unrestStage >= 2 && freeAgents) {
        const bool uprising = unrestStage == 3;
        const int attempts = uprising ? 3 : 1;
        const float probability = uprising ? params.unrestUprisingProbability : params.unrestSabotageProbability;
        for (int i = 0; i < attempts; ++i) {
            if (getRandom16() / 65536.0f < probability && igniteUnrestFire(uprising)) ++pendingSabotageFires;
        }
    }
}

bool Micropolis::igniteUnrestFire(bool uprising)
{
    int count = 0;
    for (int x = 0; x < WORLD_W; ++x) for (int y = 0; y < WORLD_H; ++y) {
        const MapValue value = map[x][y];
        const int tile = value & LOMASK;
        if ((value & ZONEBIT) && ownerMap.worldGet(x, y) != 4 && (ownerMap.worldGet(x, y) == 2 || tile == POWERPLANT ||
            tile == NUCLEAR || (uprising && tile >= COMBASE && tile < PORTBASE))) ++count;
    }
    if (!count) return false;
    int selected = getRandom(count - 1);
    for (int x = 0; x < WORLD_W; ++x) for (int y = 0; y < WORLD_H; ++y) {
        const MapValue value = map[x][y];
        const int tile = value & LOMASK;
        if ((value & ZONEBIT) && ownerMap.worldGet(x, y) != 4 && (ownerMap.worldGet(x, y) == 2 || tile == POWERPLANT ||
            tile == NUCLEAR || (uprising && tile >= COMBASE && tile < PORTBASE))) {
            if (selected-- == 0) {
                fireZone(Position(x, y), value);
                map[x][y] = randomFire();
                return true;
            }
        }
    }
    return false;
}

void Micropolis::clearCensus()
{
    poweredZoneCount = 0;
    unpoweredZoneCount = 0;
    aiUnpoweredZoneCount = 0;
    hungryZoneCount = 0;
    firePop = 0;
    roadTotal = 0;
    railTotal = 0;
    resPop = 0;
    aiPop = 0;
    farmPop = 0;
    if (rescueEnabled()) rescueFarmYieldPopulation = 0.0;
    comPop = 0;
    indPop = 0;
    resZonePop = 0;
    comZonePop = 0;
    indZonePop = 0;
    hospitalPop = 0;
    churchPop = 0;
    policeStationPop = 0;
    fireStationPop = 0;
    stadiumPop = 0;
    coalPowerPop = 0;
    nuclearPowerPop = 0;
    solarPowerPop = 0;
    seaportPop = 0;
    airportPop = 0;
    powerStackPointer = 0; /* Reset before Mapscan */

    fireStationMap.clear();
    //fireStationEffectMap.clear(); // Added in rev293
    policeStationMap.clear();
    //policeStationEffectMap.clear(); // Added in rev293

}


/**
 * Take monthly snaphsot of all relevant data for the historic graphs.
 * Also update variables that control building new churches and hospitals.
 * @todo Rename to takeMonthlyCensus (or takeMonthlySnaphshot?).
 * @todo A lot of this max stuff is also done in graph.cpp
 */
void Micropolis::take10Census()
{
    // TODO: Make configurable parameters.
    int resPopDenom = 8;

    short x;
        static const float FLevels[3] = { 1.4, 1.2, 0.8 };
    /* put census#s in Historical Graphs and scroll data  */
    resHist10Max = 0;
    comHist10Max = 0;
    indHist10Max = 0;

    for (x = 118; x >= 0; x--)    {

        resHist10Max = max(resHist10Max, resHist[x]);
        comHist10Max = max(comHist10Max, comHist[x]);
        indHist10Max = max(indHist10Max, indHist[x]);

        resHist[x + 1] = resHist[x];
        comHist[x + 1] = comHist[x];
        indHist[x + 1] = indHist[x];
        crimeHist[x + 1] = crimeHist[x];
        pollutionHist[x + 1] = pollutionHist[x];
        moneyHist[x + 1] = moneyHist[x];

    }

    graph10Max = resHist10Max;
    graph10Max = max(graph10Max, comHist10Max);
    graph10Max = max(graph10Max, indHist10Max);

    resHist[0] = resPop / resPopDenom;
    comHist[0] = comPop;
    indHist[0] = indPop;

    crimeRamp += (crimeAverage - crimeRamp) / 4;
    crimeHist[0] = min(crimeRamp, (short)255);

    pollutionRamp += (pollutionAverage - pollutionRamp) / 4;
    pollutionHist[0] = min(pollutionRamp, (short)255);

    x = (cashFlow / 20) + 128;    /* scale to 0..255  */
    moneyHist[0] = clamp(x, (short)0, (short)255);

    changeCensus();

    short resPopScaled = resPop >> 8;

    if (hospitalPop < resPopScaled) {
        needHospital = 1;
    }

    if (hospitalPop > resPopScaled) {
        needHospital = -1;
    }

    if (hospitalPop == resPopScaled) {
        needHospital = 0;
    }

    int faithfulPop = resPopScaled + faith;

    if (churchPop < faithfulPop) {
        needChurch = 1;
    }

    if (churchPop > faithfulPop) {
        needChurch = -1;
    }

    if (churchPop == faithfulPop) {
        needChurch = 0;
    }
}


/* comefrom: simulate */
void Micropolis::take120Census()
{
    // TODO: Make configurable parameters.
    int resPopDenom = 8;

    /* Long Term Graphs */
    short x;

    resHist120Max = 0;
    comHist120Max = 0;
    indHist120Max = 0;

    for (x = 238; x >= 120; x--)  {

        resHist120Max = max(resHist120Max, resHist[x]);
        comHist120Max = max(comHist120Max, comHist[x]);
        indHist120Max = max(indHist120Max, indHist[x]);

        resHist[x + 1] = resHist[x];
        comHist[x + 1] = comHist[x];
        indHist[x + 1] = indHist[x];
        crimeHist[x + 1] = crimeHist[x];
        pollutionHist[x + 1] = pollutionHist[x];
        moneyHist[x + 1] = moneyHist[x];

    }

    graph120Max = resHist120Max;
    graph120Max = max(graph120Max, comHist120Max);
    graph120Max = max(graph120Max, indHist120Max);

    resHist[120] = resPop / resPopDenom;
    comHist[120] = comPop;
    indHist[120] = indPop;
    crimeHist[120] = crimeHist[0] ;
    pollutionHist[120] = pollutionHist[0];
    moneyHist[120] = moneyHist[0];
    changeCensus();
}


/** Collect taxes
 * @bug Function seems to be doing different things depending on
 *      Micropolis::totalPop value. With an non-empty city it does fund
 *      calculations. For an empty city, it immediately sets effects of
 *      funding, which seems inconsistent at least, and may be wrong
 * @bug If Micropolis::taxFlag is set, no variable is touched which seems
 *      non-robust at least
 */
void Micropolis::collectTax()
{
    short z;

    /**
     * @todo Break out so the user interface can configure this.
     */
    static const float RLevels[3] = { 0.7, 0.9, 1.2 };
    static const float FLevels[3] = { 1.4, 1.2, 0.8 };

    assert(LEVEL_COUNT == LENGTH_OF(RLevels));
    assert(LEVEL_COUNT == LENGTH_OF(FLevels));

    cashFlow = 0;

    /**
     * @todo Apparently taxFlag is never set to true in MicropolisEngine
     *       or the TCL code, so this always runs.
     * @todo Check old Mac code to see if it's ever set, and why.
     */

    if (!taxFlag) { // If the Tax Port is clear
        ++financeRevision;

        /// @todo Do something with z? Check old Mac code to see if it's used.
        z = cityTaxAverage / 48;  // post release

        cityTaxAverage = 0;

        policeFund = (long)policeStationPop * 100;
        fireFund = (long)fireStationPop * 100;
        roadFund = (long)((roadTotal + (railTotal * 2)) * RLevels[gameLevel]);
        humanTaxFund = (long)((((Quad)totalPop * landValueAverage) / 120) * cityTax * FLevels[gameLevel]);
        if (params.unrestEnabled && unrestStage >= 1) {
            humanTaxFund = (Quad)(humanTaxFund * (1.0f - params.unrestProtestTaxReduction));
        }
        automationTaxFund = 0;
        automatedJobs = 0.0f;
        if (params.unrestEnabled || params.aiFactionEnabled) {
            const float jobs = max(0.0f, (float)comHist[1] + (float)indHist[1]);
            automatedJobs = min((float)(aiPop * aiWorkFactor()) * params.jobsPerAiPop,
                min(params.maxAutomation, params.automationLimit) * jobs);
            automationTaxFund = (Quad)min((long double)std::numeric_limits<Quad>::max(),
                (long double)automatedJobs * params.automationYieldPerJob * cityTax);
            if (params.aiFactionEnabled && aiStrikeStage == 1)
                automationTaxFund = (Quad)(automationTaxFund * params.aiWorkToRuleTaxFactor);
            sabotageFires = pendingSabotageFires;
            damagedAiZones = pendingDamagedAiZones;
            damagedPowerPlants = pendingDamagedPowerPlants;
            protestMonths = pendingStageMonths[0];
            sabotageMonths = pendingStageMonths[1];
            uprisingMonths = pendingStageMonths[2];
            pendingSabotageFires = pendingDamagedAiZones = pendingDamagedPowerPlants = 0;
            for (int i = 0; i < 3; ++i) pendingStageMonths[i] = 0;
        }
        const long double aiTaxAmount = (long double)aiPop * params.aiYieldPerPop * cityTax *
            aiWorkFactor();
        if (aiTaxAmount > (long double)std::numeric_limits<Quad>::max()) {
            aiTaxFund = std::numeric_limits<Quad>::max();
        } else if (aiTaxAmount < (long double)std::numeric_limits<Quad>::min()) {
            aiTaxFund = std::numeric_limits<Quad>::min();
        } else {
            aiTaxFund = (Quad)aiTaxAmount;
        }
        taxFund = humanTaxFund;
        const long long combinedTaxFund = (long long)humanTaxFund + (long long)aiTaxFund + (long long)automationTaxFund;
        if (combinedTaxFund > (long long)std::numeric_limits<Quad>::max()) {
            taxFund = std::numeric_limits<Quad>::max();
        } else if (combinedTaxFund < (long long)std::numeric_limits<Quad>::min()) {
            taxFund = std::numeric_limits<Quad>::min();
        } else {
            taxFund = (Quad)combinedTaxFund;
        }

        foodImportCost = 0;
        foodImported = 0;
        welfareCost = 0;
        // collectTax runs after the current map-scan census. Refresh the
        // balance here so imports cover demand first observed in this census.
        foodProduction = (Quad)(farmFoodPopulation() * params.foodPerFarmPop);
        foodDemand = (Quad)((double)resPop * params.foodPerHumanPop);
        if (params.podsEnabled) {
            foodDemand += (Quad)ceil(pendingPodCityFood);
            pendingPodCityFood = 0.0;
            admissions = pendingAdmissions;
            diedInPods = pendingPodDeaths;
            bornInPods = pendingPodBirths;
            aiAdmissions = pendingAiAdmissions;
            aiDiedInPods = pendingAiPodDeaths;
            aiBornInPods = pendingAiPodBirths;
            adminAdmissions = admissions - aiAdmissions;
            adminDiedInPods = diedInPods - aiDiedInPods;
            adminBornInPods = bornInPods - aiBornInPods;
            pendingAiAdmissions = pendingAiPodDeaths = pendingAiPodBirths = 0;
            aiStrikeMonths = pendingAiStrikeMonths;
            pendingAiStrikeMonths = 0;
            pendingAdmissions = pendingPodDeaths = pendingPodBirths = 0;
        }

        const long double requestedWelfareCost = (long double)resPop * unemploymentRate *
            params.welfareCostPerPop * params.welfareLevel;
        if (requestedWelfareCost >= (long double)std::numeric_limits<Quad>::max()) {
            welfareCost = std::numeric_limits<Quad>::max();
        } else if (requestedWelfareCost > 0.0L) {
            welfareCost = (Quad)requestedWelfareCost;
        }

        if (rescueImportsEnabled() && foodDemand > foodProduction) {
            const Quad foodDeficit = foodDemand - foodProduction;
            if (rescueImportPrice() <= 0.0f) {
                foodImported = foodDeficit;
            } else if ((long long)totalFunds + (long long)taxFund - (long long)welfareCost > 0) {
                const long long availableFunds = max((long long)0, (long long)totalFunds + (long long)taxFund - (long long)welfareCost);
                const long double affordableFood = (long double)availableFunds / rescueImportPrice();
                foodImported = (Quad)min((long double)foodDeficit, affordableFood);
                long double cost = ceill((long double)foodImported * rescueImportPrice());
                if (cost > (long double)availableFunds) {
                    foodImported = (Quad)((long double)availableFunds / rescueImportPrice());
                    cost = ceill((long double)foodImported * rescueImportPrice());
                }
                foodImportCost = (Quad)cost;
            }
        }

        foodCoverage = foodDemand > 0
            ? min(1.0f, (float)((long long)foodProduction + (long long)foodImported) / (float)foodDemand)
            : 1.0f;

        if (totalPop > 0 || aiPop > 0 || welfareCost > 0) {
            // totalPop rounds down small human populations; their mandatory
            // welfare still has to be booked, including when treasury is in debt.
            const long long netCashFlow = (long long)taxFund -
                ((long long)policeFund + (long long)fireFund + (long long)roadFund + (long long)foodImportCost + (long long)welfareCost);
            if (netCashFlow > std::numeric_limits<short>::max()) {
                cashFlow = std::numeric_limits<short>::max();
            } else if (netCashFlow < std::numeric_limits<short>::min()) {
                cashFlow = std::numeric_limits<short>::min();
            } else {
                cashFlow = (short)netCashFlow;
            }
            if (foodImportCost > 0 || welfareCost > 0) {
                totalFunds -= foodImportCost + welfareCost;
                updateFunds();
            }
            const Quad fundsBeforeBudget = totalFunds;
            doBudget();
            if (params.foodPerHumanPop > 0.0f) {
                updateFundEffects();
                // The report is the actual booking, including reduced service
                // funding. Classic retains its historical cashFlow semantics.
                const long long booked = (long long)totalFunds - fundsBeforeBudget - foodImportCost - welfareCost;
                cashFlow = (short)clamp(booked, (long long)std::numeric_limits<short>::min(),
                    (long long)std::numeric_limits<short>::max());
            }
        } else {
            /* Nobody lives here. */
            roadEffect   = MAX_ROAD_EFFECT;
            policeEffect = MAX_POLICE_STATION_EFFECT;
            fireEffect   = MAX_FIRE_STATION_EFFECT;
        }
    }
}


/**
 * Update effects of (possibly reduced) funding
 *
 * It updates effects with respect to roads, police, and fire.
 * @note This function should probably not be used when #totalPop is
 *       clear (ie with an empty) city. See also bugs of #collectTax()
 * @bug I think this should be called after loading a city, or any
 *      time anything it depends on changes.
 */
void Micropolis::updateFundEffects()
{
    // Compute road effects of funding
    roadEffect = MAX_ROAD_EFFECT;
    if (roadFund > 0) {
        // Multiply with funding fraction
        roadEffect = (short)((float)roadEffect * (float)roadSpend / (float)roadFund);
    }

    // Compute police station effects of funding
    policeEffect = MAX_POLICE_STATION_EFFECT;
    if (policeFund > 0) {
        // Multiply with funding fraction
        policeEffect = (short)((float)policeEffect * (float)policeSpend / (float)policeFund);
    }

    // Compute fire station effects of funding
    fireEffect = MAX_FIRE_STATION_EFFECT;
    if (fireFund > 0) {
        // Multiply with funding fraction
        fireEffect = (short)((float)fireEffect * (float)fireSpend / (float)fireFund);
    }

#if 0
    printf("========== updateFundEffects road %d %d %d fire %d %d %d police %d %d %d\n",
        (int)roadEffect, (int)roadSpend, (int)roadFund,
        (int)fireEffect, (int)fireSpend, (int)fireFund,
        (int)policeEffect, (int)policeSpend, (int)policeFund);
#endif

    mustDrawBudget = 1;
}


/* comefrom: simulate doSimInit */
void Micropolis::mapScan(int x1, int x2)
{
    short x, y;

    //printf("mapScan %d %d\n", x1, x2);

    for (x = x1; x < x2; x++) {
        for (y = 0; y < WORLD_H; y++) {

            MapValue mapVal = map[x][y];
            MapTile tile = mapVal & LOMASK;  /* Mask off status bits  */

            const Byte owner = ownerMap.worldGet(x, y);
            const bool residentialCenter = (mapVal & ZONEBIT) && tile < HOSPITAL;
            // Removed/replaced centers and human-to-AI conversions never reach
            // doResidential as a human zone again. Retire their actual snapshot,
            // rather than forcing the city-wide population identity to balance.
            if (!residentialCenter || owner == 2) {
                if (!rescueEnabled() || !residentialCenter)
                    humanPodOffsetMap.worldSet(x, y, 0);
                const Byte previousPop = previousHumanResPopMap.worldGet(x, y);
                lostToDemand += previousPop;
                previousHumanResPopMap.worldSet(x, y, 0);
                humanLossCauseMap.worldSet(x, y, 0);
            }
            const bool farmCenter = (mapVal & ZONEBIT) &&
                (tile == INDCLR || (tile >= IZB && tile <= IZB + 7 * 9 && ((tile - IZB) % 9) == 0));
            if (params.aiFactionEnabled && owner == 2 && tile >= FIRE && tile <= LASTFIRE)
                ++pendingAiFireLots;
            if ((owner == 1 || owner == 2) && !residentialCenter) ownerMap.worldSet(x, y, 0);
            if ((owner >= 3 && owner <= 5) && !farmCenter) ownerMap.worldSet(x, y, 0);

            if (tile == DIRT) {
                continue;
            }

            if (tile < FLOOD) {
                continue;
            }

            // tile >= FLOOD

            Position pos(x, y);


            if (tile < ROADBASE) {

                if (tile >= FIREBASE) {
                    firePop++;
                    if (!(getRandom16() & 3)) {
                        doFire(pos);    /* 1 in 4 times */
                    }
                    continue;
                }

                if (tile < RADTILE) {
                    doFlood(pos);
                } else {
                    doRadTile(pos);
                }

                continue;
            }

            if (newPower && (mapVal & CONDBIT)) {
                // Copy PWRBIT from powerGridMap
                setZonePower(pos);
            }

            if (tile >= ROADBASE && tile < POWERBASE) {
                doRoad(pos);
                continue;
            }

            if (mapVal & ZONEBIT) { /* process Zones */
                doZone(pos);
                continue;
            }

            if (tile >= RAILBASE && tile < RESBASE) {
                doRail(pos);
                continue;
            }

            if (tile >= SOMETINYEXP && tile <= LASTTINYEXP) {
                /* clear AniRubble */
                map[x][y] = randomRubble();
            }
        }
    }
}


/**
 * Handle rail track.
 * Generate a train, and handle road deteriorating effects.
 * @param pos Position of the rail.
 */
void Micropolis::doRail(const Position &pos)
{
    railTotal++;

    generateTrain(pos.posX, pos.posY);

    if (roadEffect < (15 * MAX_ROAD_EFFECT / 16)) {

        // roadEffect < 15/16 of max road, enable deteriorating rail
        if (!(getRandom16() & 511)) {

            MapValue curValue = map[pos.posX][pos.posY];
            if (!(curValue & CONDBIT)) {

                // Otherwise the '(getRandom16() & 31)' makes no sense
                assert(MAX_ROAD_EFFECT == 32);
                if (roadEffect < (getRandom16() & 31)) {
                    MapTile tile = curValue & LOMASK;
                    if (tile < RAILBASE + 2) {
                        map[pos.posX][pos.posY] = RIVER;
                    } else {
                        map[pos.posX][pos.posY] = randomRubble();
                    }
                    return;
                }
            }
        }
    }
}


/**
 * Handle decay of radio-active tile
 * @param pos Position of the radio-active tile.
 */
void Micropolis::doRadTile(const Position &pos)
{
    if ((getRandom16() & 4095) == 0) {
        map[pos.posX][pos.posY] = DIRT; /* Radioactive decay */
    }
}


/**
 * Handle road tile.
 * @param pos Position of the road.
 */
void Micropolis::doRoad(const Position &pos)
{
    short tden, z;
    static const short densityTable[3] = { ROADBASE, LTRFBASE, HTRFBASE };

    roadTotal++;

    MapValue mapValue = map[pos.posX][pos.posY];
    MapTile tile = mapValue & LOMASK;

    /* generateBus(pos.posX, pos.posY); */

    if (roadEffect < (15 * MAX_ROAD_EFFECT / 16)) {
        // roadEffect < 15/16 of max road, enable deteriorating road
        if ((getRandom16() & 511) == 0) {
            if (!(mapValue & CONDBIT)) {
                assert(MAX_ROAD_EFFECT == 32); // Otherwise the '(getRandom16() & 31)' makes no sense
                if (roadEffect < (getRandom16() & 31)) {
                    if ((tile & 15) < 2 || (tile & 15) == 15) {
                        map[pos.posX][pos.posY] = RIVER;
                    } else {
                        map[pos.posX][pos.posY] = randomRubble();
                    }
                    return;
                }
            }
        }
    }

    if ((mapValue & BURNBIT) == 0) { /* If Bridge */
        roadTotal += 4; // Bridge counts as 4 road tiles
        if (doBridge(Position(pos.posX, pos.posY), tile)) {
            return;
        }
    }

    if (tile < LTRFBASE) {
        tden = 0;
    } else if (tile < HTRFBASE) {
        tden = 1;
    } else {
        roadTotal++; // Heavy traffic counts as 2 roads.
        tden = 2;
    }

    short trafficDensity = trafficDensityMap.worldGet(pos.posX, pos.posY) >>6;

    if (trafficDensity > 1) {
        trafficDensity--;
    }

    if (tden != trafficDensity) { /* tden 0..2   */
        z = ((tile - ROADBASE) & 15) + densityTable[trafficDensity];
        z |= mapValue & (ALLBITS - ANIMBIT);

        if (trafficDensity > 0) {
            z |= ANIMBIT;
        }

        map[pos.posX][pos.posY] = z;
    }
}


/**
 * Handle a bridge.
 * @param pos Position of the bridge.
 * @param tile Tile value of the bridge.
 * @return ???
 *
 * @todo What does this function return?
 * @todo Discover the structure of all the magic constants.
 */
bool Micropolis::doBridge(const Position &pos, MapTile tile)
{
    static short HDx[7] = { -2,  2, -2, -1,  0,  1,  2 };
    static short HDy[7] = { -1, -1,  0,  0,  0,  0,  0 };
    static short HBRTAB[7] = {
        HBRDG1 | BULLBIT, HBRDG3 | BULLBIT, HBRDG0 | BULLBIT,
        RIVER, BRWH | BULLBIT, RIVER, HBRDG2 | BULLBIT,
    };
    static short HBRTAB2[7] = {
        RIVER, RIVER, HBRIDGE | BULLBIT, HBRIDGE | BULLBIT, HBRIDGE | BULLBIT,
        HBRIDGE | BULLBIT, HBRIDGE | BULLBIT,
    };
    static short VDx[7] = {  0,  1,  0,  0,  0,  0,  1 };
    static short VDy[7] = { -2, -2, -1,  0,  1,  2,  2 };
    static short VBRTAB[7] = {
        VBRDG0 | BULLBIT, VBRDG1 | BULLBIT, RIVER, BRWV | BULLBIT,
        RIVER, VBRDG2 | BULLBIT, VBRDG3 | BULLBIT,
    };
    static short VBRTAB2[7] = {
        VBRIDGE | BULLBIT, RIVER, VBRIDGE | BULLBIT, VBRIDGE | BULLBIT,
        VBRIDGE | BULLBIT, VBRIDGE | BULLBIT, RIVER,
    };
    int z, x, y, MPtem;

    if (tile == BRWV) { /*  Vertical bridge close */

        if ((!(getRandom16() & 3)) && getBoatDistance(pos) > 340) {

            for (z = 0; z < 7; z++) { /* Close */

                x = pos.posX + VDx[z];
                y = pos.posY + VDy[z];

                if (testBounds(x, y)) {

                    if ((map[x][y] & LOMASK) == (VBRTAB[z] & LOMASK)) {
                        map[x][y] = VBRTAB2[z];
                    }

                }
            }
        }
        return true;
    }

    if (tile == BRWH) { /*  Horizontal bridge close  */

        if ((!(getRandom16() & 3)) && getBoatDistance(pos) > 340) {

            for (z = 0; z < 7; z++) { /* Close */

                x = pos.posX + HDx[z];
                y = pos.posY + HDy[z];

                if (testBounds(x, y)) {

                    if ((map[x][y] & LOMASK) == (HBRTAB[z] & LOMASK)) {

                        map[x][y] = HBRTAB2[z];

                    }
                }
            }
        }
        return true;
    }

    if (getBoatDistance(pos) < 300 || (!(getRandom16() & 7))) {
        if (tile & 1) {
            if (pos.posX < WORLD_W - 1) {
                if (map[pos.posX + 1][pos.posY] == CHANNEL) { /* Vertical open */

                    for (z = 0; z < 7; z++) {

                        x = pos.posX + VDx[z];
                        y = pos.posY + VDy[z];

                        if (testBounds(x, y)) {

                            MPtem = map[x][y];
                            if (MPtem == CHANNEL || ((MPtem & 15) == (VBRTAB2[z] & 15))) {
                                map[x][y] = VBRTAB[z];
                            }
                        }
                    }
                    return true;
                }
            }
            return false;

        } else {

            if (pos.posY > 0) {
                if (map[pos.posX][pos.posY - 1] == CHANNEL) {

                    /* Horizontal open  */
                    for (z = 0; z < 7; z++) {

                        x = pos.posX + HDx[z];
                        y = pos.posY + HDy[z];

                        if (testBounds(x, y)) {

                            MPtem = map[x][y];
                            if (((MPtem & 15) == (HBRTAB2[z] & 15)) || MPtem == CHANNEL) {
                                map[x][y] = HBRTAB[z];
                            }
                        }
                    }
                    return true;
                }
            }
            return false;
        }

    }
    return false;
}


/**
 * Compute distance to nearest boat from a given bridge.
 * @param pos Position of bridge.
 * @return Distance to nearest boat.
 */
int Micropolis::getBoatDistance(const Position &pos)
{
    int sprDist;
    SimSprite *sprite;

    int dist = 99999;
    int mx = pos.posX * 16 + 8;
    int my = pos.posY * 16 + 8;

    for (sprite = spriteList; sprite != NULL; sprite = sprite->next) {
        if (sprite->type == SPRITE_SHIP && sprite->frame != 0) {

            sprDist = absoluteValue(sprite->x + sprite->xHot - mx)
                    + absoluteValue(sprite->y + sprite->yHot - my);

            dist = min(dist, sprDist);
        }
    }
    return dist;
}


/**
 * Handle tile being on fire.
 * @param pos Position of the fire.
 *
 * @todo Needs a notion of iterative neighbour tiles computing.
 * @todo Use a getFromMap()-like function here.
 * @todo Extract constants of fire station effectiveness from here.
 */
void Micropolis::doFire(const Position &pos)
{
    static const short DX[4] = { -1,  0,  1,  0 };
    static const short DY[4] = {  0, -1,  0,  1 };

    // Try to set neighbouring tiles on fire as well
    for (short z = 0; z < 4; z++) {

        if ((getRandom16() & 7) == 0) {

            short xTem = pos.posX + DX[z];
            short yTem = pos.posY + DY[z];

            if (testBounds(xTem, yTem)) {

                MapValue c = map[xTem][yTem];
                if (!(c & BURNBIT)) {
                    continue;
                }

                if (c & ZONEBIT) {
                    // Neighbour is a zone and burnable
                    fireZone(Position(xTem, yTem), c);

                    if ((c & LOMASK) > IZB) { /* Explode */
                          makeExplosionAt(xTem *16 + 8, yTem * 16 + 8);
                    }
                }

                map[xTem][yTem] = randomFire();
            }
        }
    }

    // Compute likelyhood of fire running out of fuel
    short rate = 10; // Likelyhood of extinguishing (bigger means less chance)
    short z = fireStationEffectMap.worldGet(pos.posX, pos.posY);

    if (z > 0) {
        rate = 3;
        if (z > 20) {
            rate = 2;
        }
        if (z > 100) {
            rate = 1;
        }
    }

    // Decide whether to put out the fire.
    if (getRandom(rate) == 0) {
        map[pos.posX][pos.posY] = randomRubble();
    }
}


/**
 * Handle a zone on fire.
 *
 * Decreases rate of growth of the zone, and makes remaining tiles bulldozable.
 *
 * @param pos Position of the zone on fire.
 * @param ch  Character of the zone.
 */
void Micropolis::fireZone(const Position &pos, MapValue ch)
{
    if (params.unrestEnabled) {
        if (ownerMap.worldGet(pos.posX, pos.posY) == 2) ++pendingDamagedAiZones;
        if ((ch & LOMASK) == POWERPLANT || (ch & LOMASK) == NUCLEAR) ++pendingDamagedPowerPlants;
    }
    short XYmax;

    int value = rateOfGrowthMap.worldGet(pos.posX, pos.posY);
    value = clamp(value - 20, -200, 200);
    rateOfGrowthMap.worldSet(pos.posX, pos.posY, value);

    ch = ch & LOMASK;

    if (ch < PORTBASE) {
        XYmax = 2;
    } else {
        if (ch == AIRPORT) {
            XYmax = 5;
        } else {
            XYmax = 4;
        }
    }

    // Make remaining tiles of the zone bulldozable
    for (short x = -1; x < XYmax; x++) {
        for (short y = -1; y < XYmax; y++) {

            short xTem = pos.posX + x;
            short yTem = pos.posY + y;

            if (!testBounds(xTem, yTem)) {
                continue;
            }

            if ((MapTile)(map[xTem][yTem] & LOMASK) >= ROADBASE) {
                /* post release */
                map[xTem][yTem] |= BULLBIT;
            }

        }
    }
}


/**
 * Repair a zone at \a pos.
 * @param pos   Center-tile position of the zone.
 * @param zCent Value of the center tile.
 * @param zSize Size of the zone (in both directions).
 */
void Micropolis::repairZone(const Position &pos, MapTile zCent, short zSize)
{
    MapTile tile = zCent - 2 - zSize;

    // y and x loops one position shifted to compensate for the center-tile position.
    for (short y = -1; y < zSize - 1; y++) {
        for (short x = -1; x < zSize - 1; x++) {

            int xx = pos.posX + x;
            int yy = pos.posY + y;

            tile++;

            if (testBounds(xx, yy)) {

                MapValue mapValue = map[xx][yy];

                if (mapValue & ZONEBIT) {
                    continue;
                }

                if (mapValue & ANIMBIT) {
                    continue;
                }

                MapTile mapTile = mapValue & LOMASK;

                if (mapTile < RUBBLE || mapTile >= ROADBASE) {
                    map[xx][yy] = tile | CONDBIT | BURNBIT;
                }
            }
        }
    }
}


/**
 * Update special zones.
 * @param pos     Position of the zone.
 * @param powerOn Zone is powered.
 */
void Micropolis::doSpecialZone(const Position &pos, bool powerOn)
{
    // Bigger numbers reduce chance of nuclear melt down
    static const short meltdownTable[3] = { 30000, 20000, 10000 };

    MapTile tile = map[pos.posX][pos.posY] & LOMASK;

    switch (tile) {

        case POWERPLANT:

            coalPowerPop++;

            if ((cityTime & 7) == 0) {
                repairZone(pos, POWERPLANT, 4); /* post */
            }

            pushPowerStack(pos);
            coalSmoke(pos);

            return;

        case NUCLEAR:

            assert(LEVEL_COUNT == LENGTH_OF(meltdownTable));

            if (enableDisasters && !getRandom(meltdownTable[gameLevel])) {
                doMeltdown(pos);
                return;
            }

            nuclearPowerPop++;

            if ((cityTime & 7) == 0) {
                repairZone(pos, NUCLEAR, 4); /* post */
            }

            pushPowerStack(pos);

            return;

        case SOLARPOWER:

            solarPowerPop++;

            if ((cityTime & 7) == 0) {
                repairZone(pos, SOLARPOWER, 4);
            }

            pushPowerStack(pos);

            return;

        case FIRESTATION: {

            int z;

            fireStationPop++;

            if (!(cityTime & 7)) {
                repairZone(pos, FIRESTATION, 3); /* post */
            }

            if (powerOn) {
                z = fireEffect;                   /* if powered get effect  */
            } else {
                z = fireEffect / 2;               /* from the funding ratio  */
            }

            Position pos2(pos);
            bool foundRoad = findPerimeterRoad(&pos2);

            if (!foundRoad) {
                z = z / 2;                        /* post FD's need roads  */
            }

            int value = fireStationMap.worldGet(pos2.posX, pos2.posY);
            value += z;
            fireStationMap.worldSet(pos2.posX, pos2.posY, value);

            return;
        }

        case POLICESTATION: {

            int z;

            policeStationPop++;

            if (!(cityTime & 7)) {
                repairZone(pos, POLICESTATION, 3); /* post */
            }

            if (powerOn) {
                z = policeEffect;
            } else {
                z = policeEffect / 2;
            }

            Position pos2(pos);
            bool foundRoad = findPerimeterRoad(&pos2);

            if (!foundRoad) {
                z = z / 2; /* post PD's need roads */
            }

            int value = policeStationMap.worldGet(pos2.posX, pos2.posY);
            value += z;
            policeStationMap.worldSet(pos2.posX, pos2.posY, value);

            return;
        }

        case STADIUM:  // Empty stadium

            stadiumPop++;

            if (!(cityTime & 15)) {
                repairZone(pos, STADIUM, 4);
            }

            if (powerOn) {
                // Every now and then, display a match
                if (((cityTime + pos.posX + pos.posY) & 31) == 0) {
                    drawStadium(pos, FULLSTADIUM);
                    map[pos.posX + 1][pos.posY] = FOOTBALLGAME1 + ANIMBIT;
                    map[pos.posX + 1][pos.posY + 1] = FOOTBALLGAME2 + ANIMBIT;
                }
            }

            return;

       case FULLSTADIUM:  // Full stadium

            stadiumPop++;

            if (((cityTime + pos.posX + pos.posY) & 7) == 0) {
                // Stop the match
                drawStadium(pos, STADIUM);
            }

            return;

       case AIRPORT:

            airportPop++;

            if ((cityTime & 7) == 0) {
                repairZone(pos, AIRPORT, 6);
            }

            // If powered, display a rotating radar
            if (powerOn) {
                if ((map[pos.posX + 1][pos.posY - 1] & LOMASK) == RADAR) {
                    map[pos.posX + 1][pos.posY - 1] = RADAR0 + ANIMBIT + CONDBIT + BURNBIT;
                }
            } else {
                map[pos.posX + 1][pos.posY - 1] = RADAR + CONDBIT + BURNBIT;
            }

            if (powerOn) { // Handle the airport only if there is power
                doAirport(pos);
            }

            return;

       case PORT:

            seaportPop++;

            if ((cityTime & 15) == 0) {
                repairZone(pos, PORT, 4);
            }

            // If port has power and there is no ship, generate one
            if (powerOn && getSprite(SPRITE_SHIP) == NULL) {
                generateShip();
            }

            return;
    }
}


/**
 * Draw a stadium (either full or empty).
 * @param center Center tile position of the stadium.
 * @param z Base tile value.
 *
 * @todo Merge with zonePlop()-like function.
 */
void Micropolis::drawStadium(const Position &center, MapTile z)
{
    int x, y;

    z = z - 5;

    for (y = center.posY - 1; y < center.posY + 3; y++) {
        for (x = center.posX - 1; x < center.posX + 3; x++) {
            map[x][y] = z | BNCNBIT;
            z++;
        }
    }

    map[center.posX][center.posY] |= ZONEBIT | PWRBIT;
}


/**
 * Generate a airplane or helicopter every now and then.
 * @param pos Position of the airport to start from.
 */
void Micropolis::doAirport(const Position &pos)
{
    if (getRandom(5) == 0) {
        generatePlane(pos);
        return;
    }

    if (getRandom(12) == 0) {
        generateCopter(pos);
    }
}


/**
 * Draw coal smoke tiles around given position (of a coal power plant).
 * @param pos Center tile of the coal power plant
 */
void Micropolis::coalSmoke(const Position &pos)
{
    static const short SmTb[4] = {
        COALSMOKE1, COALSMOKE2,
        COALSMOKE3, COALSMOKE4,
    };
    static const short dx[4] = {  1,  2,  1,  2 };
    static const short dy[4] = { -1, -1,  0,  0 };

    for (short x = 0; x < 4; x++) {
        map[pos.posX + dx[x]][pos.posY + dy[x]] =
            SmTb[x] | ANIMBIT | CONDBIT | PWRBIT | BURNBIT;
    }
}


/**
 * Perform a nuclear melt-down disaster
 * @param pos Position of the nuclear power plant that melts.
 */
void Micropolis::doMeltdown(const Position &pos)
{
    makeExplosion(pos.posX - 1, pos.posY - 1);
    makeExplosion(pos.posX - 1, pos.posY + 2);
    makeExplosion(pos.posX + 2, pos.posY - 1);
    makeExplosion(pos.posX + 2, pos.posY + 2);

    // Whole power plant is at fire
    for (int x = pos.posX - 1; x < pos.posX + 3; x++) {
        for (int y = pos.posY - 1; y < pos.posY + 3; y++) {
            map[x][y] = randomFire();
        }
    }

    // Add lots of radiation tiles around the plant
    for (int z = 0; z < 200; z++)  {

        int x = pos.posX - 20 + getRandom(40);
        int y = pos.posY - 15 + getRandom(30);

        if (!testBounds(x, y)) { // Ignore off-map positions
            continue;
        }

        MapValue t = map[x][y];

        if (t & ZONEBIT) {
            continue; // Ignore zones
        }

        if ((t & BURNBIT) || t == DIRT) {
            map[x][y] = RADTILE; // Make tile radio-active
        }

    }

    // Report disaster to the user
    sendMessage(MESSAGE_NUCLEAR_MELTDOWN, pos.posX, pos.posY, true, true);
}


////////////////////////////////////////////////////////////////////////
