/* power.cpp
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
 * @file power.cpp
 * @brief Manages power distribution in the Micropolis game.
 *
 * This file contains functions for scanning the game map to
 * distribute power from power plants to other structures. It utilizes
 * a power stack to track and update the power status of tiles. The
 * file includes constants for the power strength of coal and nuclear
 * power plants, and functions to test for conductive tiles, scan the
 * map for power distribution, and manipulate the power stack.
 */


////////////////////////////////////////////////////////////////////////


#include "micropolis.h"
#include "text.h"

#include <vector>

////////////////////////////////////////////////////////////////////////
// Constants

/** Number of tiles that a coal power plant can supply power to. */
static const Quad COAL_POWER_STRENGTH = 700L;

/** Number of tiles that a nuclear power plant can supply power to. */
static const Quad NUCLEAR_POWER_STRENGTH = 2000L;

/** Number of tiles that a solar power plant can supply power to. */
static const Quad SOLAR_POWER_STRENGTH = 1000L;


////////////////////////////////////////////////////////////////////////


/**
 * Check at position \a pos for a power-less conducting tile in the
 * direction \a testDir.
 * @param pos     Position to start from.
 * @param testDir Direction to investigate.
 * @return Unpowered tile has been found in the indicated direction.
 * @todo Re-use something like Micropolis::getFromMap(), and fold this function
 *       into its caller.
 */
bool Micropolis::testForConductive(const Position& pos, Direction2 testDir)
{
    Position movedPos(pos);

    if (movedPos.move(testDir)) {
        if ((map[movedPos.posX][movedPos.posY] & CONDBIT) == CONDBIT) {
            if (!powerGridMap.worldGet(movedPos.posX, movedPos.posY)) {
                return true;
            }
        }
    }

    return false;
}


/**
 * Scan the map for powered tiles, and copy them to the Micropolis::powerGridMap
 * array.
 * Also warns the user about using too much power ('buy another power plant').
 */
void Micropolis::doPowerScan()
{
    // Clear power map.
    powerGridMap.clear();

    // Power that the combined power plants can deliver.
    Quad maxPower = coalPowerPop * COAL_POWER_STRENGTH +
                    nuclearPowerPop * NUCLEAR_POWER_STRENGTH +
                    solarPowerPop * SOLAR_POWER_STRENGTH;

    const Quad aiDemand = (Quad)aiPop * params.aiPowerPerPop;
    const int stackLimit = POWER_STACK_SIZE - 2;

    // Count the complete network without changing powerGridMap. Preserve the
    // engine's original stack/path order so this census cannot alter which
    // tiles are powered in the normal, unconstrained case.
    const auto countNetworkStepsAndReachableMap = [&]() -> Quad {
        powerReachableMap.clear();
        std::vector<unsigned char> aiResidentialTiles((size_t)WORLD_W * WORLD_H, 0);
        for (int zoneX = 0; zoneX < WORLD_W; ++zoneX) {
            for (int zoneY = 0; zoneY < WORLD_H; ++zoneY) {
                if (ownerMap.worldGet(zoneX, zoneY) != 2) continue;
                for (int tileX = max(0, zoneX - 1); tileX <= min(WORLD_W - 1, zoneX + 1); ++tileX) {
                    for (int tileY = max(0, zoneY - 1); tileY <= min(WORLD_H - 1, zoneY + 1); ++tileY) {
                        aiResidentialTiles[(size_t)tileX * WORLD_H + tileY] = 1;
                    }
                }
            }
        }
        std::vector<Position> pending;
        pending.reserve(stackLimit);
        for (int i = 1; i <= powerStackPointer; ++i) {
            pending.push_back(powerStackXY[i]);
        }
        std::vector<unsigned char> visited((size_t)WORLD_W * WORLD_H, 0);
        Quad processed = 0;
        Quad reachableTiles = 0;
        Quad aiResidentialNetworkTiles = 0;

        while (!pending.empty()) {
            Position pos = pending.back();
            pending.pop_back();
            Direction2 anyDir = DIR2_INVALID;
            int conNum = 0;
            do {
                if (anyDir != DIR2_INVALID && !pos.move(anyDir)) break;
                const size_t index = (size_t)pos.posX * WORLD_H + pos.posY;
                // Keep T compatible with the original engine counter: each
                // flood-fill step consumes one unit, including branch-point
                // revisits. The bitmap below remains unique for reachability.
                ++processed;
                if (!visited[index]) {
                    visited[index] = 1;
                    powerReachableMap.worldSet(pos.posX, pos.posY, 1);
                    ++reachableTiles;
                    if (aiResidentialTiles[index]) ++aiResidentialNetworkTiles;
                }
                conNum = 0;
                Direction2 dir = DIR2_BEGIN;
                while (dir < DIR2_END && conNum < 2) {
                    Position adjacent(pos);
                    if (adjacent.move(dir)) {
                        const size_t adjacentIndex = (size_t)adjacent.posX * WORLD_H + adjacent.posY;
                        if ((map[adjacent.posX][adjacent.posY] & CONDBIT) == CONDBIT && !visited[adjacentIndex]) {
                            ++conNum;
                            anyDir = dir;
                        }
                    }
                    dir = increment90(dir);
                }
                if (conNum > 1 && (int)pending.size() < stackLimit) pending.push_back(pos);
            } while (conNum);
        }
        powerNetworkReachableTiles = reachableTiles;
        powerAiResidentialNetworkTiles = aiResidentialNetworkTiles;
        return processed;
    };

    const Quad networkSteps = countNetworkStepsAndReachableMap();
    powerNetworkSteps = networkSteps;
    // Preserve the existing power-allocation traversal and reported demand;
    // the reserve estimate below separately classifies unique reachable tiles.
    const Quad totalDemand = networkSteps + aiDemand;
    const Quad availableCapacity = max((Quad)0, maxPower);
    const Quad uniquePhysicalDemand = powerNetworkReachableTiles + aiDemand;
    Quad tileBudget = networkSteps;
    short priority = params.powerPriority;
    if (priority < 0 || priority > 2) priority = 0;

    // Revisited branch points are historical work units, not additional
    // physical consumers. If the unique network plus AI load fits, do not
    // create a shortage solely because the compatibility counter revisited tiles.
    const bool classicPowerRules = aiPop == 0 && params.powerPriority == 0 &&
        params.foodPerHumanPop == 0.0f && !params.foodImportEnabled;
    if (totalDemand <= availableCapacity ||
        (!classicPowerRules && uniquePhysicalDemand <= availableCapacity)) {
        aiCoverage = 1.0f;
        tileBudget = -1; // No shortage: preserve the full legacy grid traversal.
    } else {
        sendMessage(MESSAGE_NOT_ENOUGH_POWER);
        if (priority == 1) {
            tileBudget = min(networkSteps, availableCapacity);
            aiCoverage = aiDemand > 0
                ? clamp((float)(availableCapacity - tileBudget) / (float)aiDemand, 0.0f, 1.0f)
                : 1.0f;
        } else if (priority == 2) {
            const Quad allocatedAi = min(aiDemand, max((Quad)0, maxPower));
            tileBudget = max((Quad)0, availableCapacity - allocatedAi);
            aiCoverage = aiDemand > 0 ? (float)allocatedAi / (float)aiDemand : 1.0f;
        } else {
            const float factor = totalDemand > 0
                ? (float)maxPower / (float)totalDemand
                : 1.0f;
            tileBudget = (Quad)(networkSteps * factor);
            aiCoverage = factor;
        }
    }

    // This is the original engine walk, limited only by the allocated tile
    // budget. Keeping it intact preserves legacy powered-tile order.
    Quad poweredTiles = 0;
    while (powerStackPointer > 0 && (tileBudget < 0 || poweredTiles < tileBudget)) {
        Position pos = pullPowerStack();
        Direction2 anyDir = DIR2_INVALID;
        int conNum;
        do {
            if (anyDir != DIR2_INVALID) pos.move(anyDir);
            if (tileBudget >= 0 && poweredTiles >= tileBudget) break;
            ++poweredTiles;
            powerGridMap.worldSet(pos.posX, pos.posY, 1);
            conNum = 0;
            Direction2 dir = DIR2_BEGIN;
            while (dir < DIR2_END && conNum < 2) {
                if (testForConductive(pos, dir)) {
                    ++conNum;
                    anyDir = dir;
                }
                dir = increment90(dir);
            }
            if (conNum > 1) pushPowerStack(pos);
        } while (conNum);
    }
    powerStackPointer = 0;
    powerCapacity = maxPower;
    powerDemand = totalDemand;
}


/**
 * Push position \a pos onto the power stack if there is room.
 * @param pos Position to push.
 */
void Micropolis::pushPowerStack(const Position &pos)
{
    if (powerStackPointer < (POWER_STACK_SIZE - 2)) {
        powerStackPointer++;
        powerStackXY[powerStackPointer] = pos;
    }
}


/**
 * Pull a position from the power stack.
 * @return Pulled position.
 * @pre Stack must be non-empty (powerStackPointer > 0).
 */
Position Micropolis::pullPowerStack()
{
    assert(powerStackPointer > 0);
    powerStackPointer--;
    return powerStackXY[powerStackPointer + 1];
}


////////////////////////////////////////////////////////////////////////
