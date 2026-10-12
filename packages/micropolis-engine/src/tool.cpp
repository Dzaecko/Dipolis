/* tool.cpp
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
 * @file tool.cpp
 * @brief Implements tool actions and effects for Micropolis game.
 *
 * This file defines the behavior and effects of various tools (like
 * bulldozer, road construction, zone creation) used in Micropolis. It
 * includes functions for handling tool actions, applying their
 * effects to the game world, and managing the cost and consequences
 * of these actions. The file also contains logic for specific tools
 * such as query, wire, park, land alteration, and various zone
 * constructions (residential, commercial, industrial, etc.).
 */


////////////////////////////////////////////////////////////////////////


#include "micropolis.h"
#include <algorithm>
#include <sstream>


////////////////////////////////////////////////////////////////////////

/** Constructor. */
ToolEffects::ToolEffects(Micropolis *mpolis)
{
    this->sim = mpolis;

    this->clear();
}

ToolEffects::~ToolEffects()
{
    /* free all frontend messages */
    while(!this->frontendMessages.empty()) {
        delete this->frontendMessages.back();
        this->frontendMessages.pop_back();
    }
}

/** Reset all effects. */
void ToolEffects::clear()
{
    this->cost = 0;
    this->modifications.clear();

    /* free all frontend messages */
    while(!this->frontendMessages.empty()) {
        delete this->frontendMessages.back();
        this->frontendMessages.pop_back();
    }
}

/**
 * Perform the effects stored in the object to the simulator world.
 * @param sim Simulator object to modify.
 * @post Effects have been copied to the simulator world, and the #ToolEffects
 *       object is ready for the next use.
 */
void ToolEffects::modifyWorld()
{
    WorldModificationsMap::const_iterator modIter;
    FrontendMessages::const_iterator msgIter;
    Micropolis *mpolis = this->sim;

    mpolis->spend(this->cost); // Spend the costs
    mpolis->updateFunds();

    /* Modify the world. */
    for (modIter = this->modifications.begin();
                    modIter != this->modifications.end(); modIter++) {
        Position pos(modIter->first);
        mpolis->map[pos.posX][pos.posY] = modIter->second;
    }

    /* And finally send the messages. */
    for (msgIter = this->frontendMessages.begin();
                    msgIter != this->frontendMessages.end(); msgIter++) {
        (*msgIter)->sendMessage(mpolis);
    }

    this->clear();
}

/**
 * If there are enough funds, apply the effects.
 * @return The effects have been applied.
 * @note If funding was not adequate, the object is not modified (that is, the
 *       effects are still available).
 */
bool ToolEffects::modifyIfEnoughFunding()
{
    if (this->sim->totalFunds < this->cost) {
        return false; // Not enough money
    }

    this->modifyWorld();
    return true;
}

/**
 * Get a map value from the world.
 * Unlike the simulator world, this method takes modifications made
 * previously by (other) tools into account.
 * @param pos Position of queried map value. Position must be on-map.
 * @return Map value of the queried position.
 */
MapValue ToolEffects::getMapValue(const Position &pos) const
{
    WorldModificationsMap::const_iterator iter;

    iter = this->modifications.find(pos);
    if (iter == this->modifications.end()) {
        return this->sim->map[pos.posX][pos.posY];
    }

    return (*iter).second;
}

/**
 * Set a new map value.
 * @param pos    Position to set.
 * @param mapVal Value to set.
 */
void ToolEffects::setMapValue(const Position &pos, MapValue mapVal)
{
    this->modifications[pos] = mapVal;
}

////////////////////////////////////////////////////////////////////////
// BuildingProperties

BuildingProperties::BuildingProperties(int xs, int ys, MapTile base,
                                       EditingTool tl, std::string tName, bool anim) :
        sizeX(xs),
        sizeY(ys),
        baseTile(base),
        tool(tl),
        toolName(tName),
        buildingIsAnimated(anim)
{
}

BuildingProperties::~BuildingProperties()
{
}


////////////////////////////////////////////////////////////////////////

/**
 * Cost of each tool.
 * Maybe move this information to eg #BuildingProperties?
 */
static const short gCostOf[] = {
     100,    100,    100,    500, /* res, com, ind, fire */
     500,      0,      5,      1, /* police, query, wire, bulldozer */
      20,     10,   5000,     10, /* rail, road, stadium, park */
    3000,   3000,   5000,  10000, /* seaport, coal, nuclear, airport */
     100,      0,      0,      0, /* network, water, land, forest */
    8000,                              /* solar power plant */
       0,
};

/**
 * Size of each tool.
 * @note Actually it is the size of the building rather than the tool.
 * @todo This information is duplicated in the #BuildingProperties at least.
 */
static const short gToolSize[] = {
    3, 3, 3, 3,
    3, 1, 1, 1,
    1, 1, 4, 1,
    4, 4, 4, 6,
    1, 1, 1, 1,
    4,
    0,
};


////////////////////////////////////////////////////////////////////////
// Utilities


/**
 * Put a park down at the give tile.
 * @param mapH    X coordinate of the tile.
 * @param mapV    Y coordinate of the tile.
 * @param effects Storage of effects of putting down the park.
 * @return Tool result.
 * @todo Add auto-bulldoze? (seems to be missing).
 */
ToolResult Micropolis::putDownPark(short mapH, short mapV, ToolEffects *effects)
{
    short value = getRandom(4);
    MapValue tile = BURNBIT | BULLBIT;

    if (value == 4) {
        tile |= FOUNTAIN | ANIMBIT;
    } else {
        tile |= value + WOODS2;
    }

    if (effects->getMapValue(mapH, mapV) != DIRT) {
        return TOOLRESULT_NEED_BULLDOZE;
    }

    effects->addCost(gCostOf[TOOL_PARK]);
    effects->setMapValue(mapH, mapV, tile);

    return TOOLRESULT_OK;
}


/**
 * Put down a communication network.
 * @param mapH X coordinate of the tile.
 * @param mapV Y coordinate of the tile.
 * @return Tool result.
 * @param effects Storage of effects of putting down the park.
 * @todo Auto-bulldoze costs should be pulled from a table/constant.
 */
ToolResult Micropolis::putDownNetwork(short mapH, short mapV,
                                      ToolEffects *effects)
{
    MapTile tile = effects->getMapTile(mapH, mapV);

    if (tile != DIRT && tally(tile)) {
        effects->addCost(gCostOf[TOOL_BULLDOZER]);
        effects->setMapValue(mapH, mapV, DIRT);
        tile = DIRT;
    }

    if (tile != DIRT) return TOOLRESULT_NEED_BULLDOZE;

    effects->setMapValue(mapH, mapV,
                         TELEBASE | CONDBIT | BURNBIT | BULLBIT | ANIMBIT);

    effects->addCost(gCostOf[TOOL_NETWORK]);

    return TOOLRESULT_OK;
}


/**
 * Put down a water tile.
 * @param mapH X coordinate of the tile.
 * @param mapV Y coordinate of the tile.
 * @return Tool result.
 */
ToolResult Micropolis::putDownWater(short mapH, short mapV,
                                    ToolEffects *effects)
{
    MapTile tile = effects->getMapTile(mapH, mapV);

    if (tile == RIVER) return TOOLRESULT_FAILED;

    effects->setMapValue(mapH, mapV, RIVER);

    effects->addCost(gCostOf[TOOL_WATER]);

    return TOOLRESULT_OK;
}


/**
 * Put down a land tile.
 * @param mapH X coordinate of the tile.
 * @param mapV Y coordinate of the tile.
 * @return Tool result.
 * @todo Auto-bulldoze deducts always 1.
 * @todo Auto-bulldoze costs should be pulled from a table/constant.
 */
ToolResult Micropolis::putDownLand(short mapH, short mapV, ToolEffects *effects)
{
    int tile = effects->getMapTile(mapH, mapV);
//    static short dx[8] = { -1,  0,  1, -1, 1, -1,  0,  1, };
//    static short dy[8] = { -1, -1, -1,  0, 0,  1,  1,  1, };


    if (tile == DIRT) return TOOLRESULT_FAILED;

    effects->setMapValue(mapH, mapV, DIRT);

//    int i;
//    for (i = 0; i < 8; i++) {
//        int xx = mapH + dx[i];
//        int yy = mapV + dy[i];
//        if (testBounds(xx, yy)) {
//            //smoothTreesAt(xx, yy, true);
//        }
//    }

    effects->addCost(gCostOf[TOOL_LAND]);

    return TOOLRESULT_OK;
}


/**
 * Put down a forest tile.
 * @param mapH X coordinate of the tile.
 * @param mapV Y coordinate of the tile.
 * @return Tool result.
 * @todo Auto-bulldoze deducts always 1.
 */
ToolResult Micropolis::putDownForest(short mapH, short mapV,
                                     ToolEffects *effects)
{
    static short dx[8] = { -1,  0,  1, -1, 1, -1,  0,  1, };
    static short dy[8] = { -1, -1, -1,  0, 0,  1,  1,  1, };

    effects->setMapValue(mapH, mapV, WOODS | BLBNBIT);

    int i;
    for (i = 0; i < 8; i++) {
        int xx = mapH + dx[i];
        int yy = mapV + dy[i];
        if (testBounds(xx, yy)) {
            smoothTreesAt(xx, yy, true, effects);
        }
    }

    effects->addCost(gCostOf[TOOL_FOREST]);

    return TOOLRESULT_OK;
}


/**
 * Compute where the 'center' (at (1,1)) of the zone is, depending on where the
 * user clicked.
 *
 * Only inner tiles are recognized, and possibly not even complete (ie stadium
 * while game is playing).
 *
 * @param id Tile character value of the tile that the user clicked on.
 * @param deltaHPtr Pointer where horizontal position correction is written to.
 * @param deltaVPtr Pointer where vertical position correction is written to.
 * @return Size of the zone clicked at (or \c 0 if clicked outside zone).
 * @todo Make this table driven.
 */
static short checkBigZone(MapTile id, short *deltaHPtr, short *deltaVPtr)
{
    switch (id) {

    case POWERPLANT:      /* check coal plant */
    case PORT:            /* check sea port */
    case NUCLEAR:         /* check nuc plant */
    case SOLARPOWER:      /* check solar plant */
    case STADIUM:         /* check stadium */
        *deltaHPtr = 0;
        *deltaVPtr = 0;
        return 4;

    case POWERPLANT + 1:  /* check coal plant */
    case COALSMOKE3:      /* check coal plant, smoke */
    case COALSMOKE3 + 1:  /* check coal plant, smoke */
    case COALSMOKE3 + 2:  /* check coal plant, smoke */
    case PORT + 1:        /* check sea port */
    case NUCLEAR + 1:     /* check nuc plant */
    case SOLARPOWER + 1:  /* check solar plant */
    case STADIUM + 1:     /* check stadium */
        *deltaHPtr = -1;
        *deltaVPtr = 0;
        return 4;

    case POWERPLANT + 4:  /* check coal plant */
    case PORT + 4:        /* check sea port */
    case NUCLEAR + 4:     /* check nuc plant */
    case SOLARPOWER + 4:  /* check solar plant */
    case STADIUM + 4:     /* check stadium */
        *deltaHPtr = 0;
        *deltaVPtr = -1;
        return 4;

    case POWERPLANT + 5:  /* check coal plant */
    case PORT + 5:        /* check sea port */
    case NUCLEAR + 5:     /* check nuc plant */
    case SOLARPOWER + 5:  /* check solar plant */
    case STADIUM + 5:     /* check stadium */
        *deltaHPtr = -1;
        *deltaVPtr = -1;
        return 4;

    case AIRPORT:         /* check airport */
        *deltaHPtr = 0;
        *deltaVPtr = 0;
        return 6;

    case AIRPORT + 1:
        *deltaHPtr = -1;
        *deltaVPtr = 0;
        return 6;

    case AIRPORT + 2:
        *deltaHPtr = -2;
        *deltaVPtr = 0;
        return 6;

    case AIRPORT + 3:
        *deltaHPtr = -3;
        *deltaVPtr = 0;
        return 6;

    case AIRPORT + 6:
        *deltaHPtr = 0;
        *deltaVPtr = -1;
        return 6;

    case AIRPORT + 7:
        *deltaHPtr = -1;
        *deltaVPtr = -1;
        return 6;

    case AIRPORT + 8:
        *deltaHPtr = -2;
        *deltaVPtr = -1;
        return 6;

    case AIRPORT + 9:
        *deltaHPtr = -3;
        *deltaVPtr = -1;
        return 6;

    case AIRPORT + 12:
        *deltaHPtr = 0;
        *deltaVPtr = -2;
        return 6;

    case AIRPORT + 13:
        *deltaHPtr = -1;
        *deltaVPtr = -2;
        return 6;

    case AIRPORT + 14:
        *deltaHPtr = -2;
        *deltaVPtr = -2;
        return 6;

    case AIRPORT + 15:
        *deltaHPtr = -3;
        *deltaVPtr = -2;
        return 6;

    case AIRPORT + 18:
        *deltaHPtr = 0;
        *deltaVPtr = -3;
        return 6;

    case AIRPORT + 19:
        *deltaHPtr = -1;
        *deltaVPtr = -3;
        return 6;

    case AIRPORT + 20:
        *deltaHPtr = -2;
        *deltaVPtr = -3;
        return 6;

    case AIRPORT + 21:
        *deltaHPtr = -3;
        *deltaVPtr = -3;
        return 6;

    default:
        *deltaHPtr = 0;
        *deltaVPtr = 0;
        return 0;

    }
}


/**
 * Can the tile be auto-bulldozed?.
 * @param tileValue Value of the tile.
 * @return \c True if the tile can be auto-bulldozed, else \c false.
 */
bool Micropolis::tally(short tileValue)
{
    return (tileValue >= FIRSTRIVEDGE  && tileValue <= LASTRUBBLE) ||
           (tileValue >= POWERBASE + 2 && tileValue <= POWERBASE + 12) ||
           (tileValue >= TINYEXP       && tileValue <= LASTTINYEXP + 2);
}


/**
 * Return the size of the zone that the tile belongs to.
 * @param tileValue Value of the tile in the zone.
 * @return Size of the zone if it is a known tile value, else \c 0.
 */
short Micropolis::checkSize(short tileValue)
{
    // check for the normal com, resl, ind 3x3 zones & the fireDept & PoliceDept
    if ((tileValue >= RESBASE - 1        && tileValue <= PORTBASE - 1) ||
        (tileValue >= LASTPOWERPLANT + 1 && tileValue <= POLICESTATION + 4) ||
        (tileValue >= CHURCH1BASE && tileValue <= CHURCH7LAST)) {
        return 3;
    }

    if ((tileValue >= PORTBASE    && tileValue <= LASTPORT) ||
        (tileValue >= COALBASE    && tileValue <= LASTPOWERPLANT) ||
        (tileValue >= SOLARPOWERBASE && tileValue <= LASTSOLARPOWER) ||
        (tileValue >= STADIUMBASE && tileValue <= LASTZONE)) {
        return 4;
    }

    return 0;
}


/**
 * Check and connect a new zone around the border.
 * @param xMap    X coordinate of top-left tile.
 * @param yMap    Y coordinate of top-left tile.
 * @param sizeX   Horizontal size of the new zone.
 * @param sizeY   Vertical size of the new zone.
 * @param effects Storage of the effects.
 */
void Micropolis::checkBorder(short xMap, short yMap, int sizeX, int sizeY,
                             ToolEffects *effects)
{
    short cnt;

    /* this will do the upper bordering row */
    for (cnt = 0; cnt < sizeX; cnt++) {
        connectTile(xMap + cnt, yMap - 1, CONNECT_TILE_FIX, effects);
    }

    /* this will do the left bordering row */
    for (cnt = 0; cnt < sizeY; cnt++) {
        connectTile(xMap - 1, yMap + cnt, CONNECT_TILE_FIX, effects);
    }

    /* this will do the bottom bordering row */
    for (cnt = 0; cnt < sizeX; cnt++) {
        connectTile(xMap + cnt, yMap + sizeY, CONNECT_TILE_FIX, effects);
    }

    /* this will do the right bordering row */
    for (cnt = 0; cnt < sizeY; cnt++) {
        connectTile(xMap + sizeX, yMap + cnt, CONNECT_TILE_FIX, effects);
    }
}

/**
 * Put down a building, starting at (\a leftX, \a topY) with size
 * (\a sizeX, \a sizeY).
 * @param leftX    Position of left column of tiles of the building.
 * @param topY     Position of top row of tiles of the building.
 * @param sizeX    Horizontal size of the building.
 * @param sizeY    Vertical size of the building.
 * @param baseTile Tile value to use at the top-left position. Tiles are laid
 *                 in column major mode.
 * @param aniFlag  Set animation flag at relative position (1, 2)
 * @param effects  Storage of the effects.
 *
 * @pre All tiles are within world boundaries.
 *
 * @todo We should ask the buildings themselves how they should be drawn.
 */
void Micropolis::putBuilding(int leftX, int topY, int sizeX, int sizeY,
                             MapTile baseTile, bool aniFlag,
                             ToolEffects *effects)
{
    for (int dy = 0; dy < sizeY; dy++) {
        int posY = topY + dy;

        for (int dx = 0; dx < sizeX; dx++) {
            int posX = leftX + dx;

            MapValue tileValue = baseTile | BNCNBIT;
            if (dx == 1) {
                if (dy == 1) {
                    tileValue |= ZONEBIT;
                } else if (dy == 2 && aniFlag) {
                    tileValue |= ANIMBIT;
                }
            }

            effects->setMapValue(posX, posY, tileValue);

            baseTile++;
        }
    }
}

/**
 * Prepare the site where a building is about to be put down.
 *
 * This function performs some basic sanity checks, and implements the
 * auto-bulldoze functionality to prepare the site.
 * All effects are stored in the \a effects object.
 *
 * @param leftX    Position of left column of tiles of the building.
 * @param topY     Position of top row of tiles of the building.
 * @param sizeX    Horizontal size of the building.
 * @param sizeY    Vertical size of the building.
 * @param effects  Storage of effects of preparing the site.
 * @return: Result of preparation.
 */
ToolResult Micropolis::prepareBuildingSite(int leftX, int topY,
                                           int sizeX, int sizeY,
                                           ToolEffects *effects)
{
    // Check that the entire site is on the map
    if (leftX < 0 || leftX + sizeX > WORLD_W) {
        return TOOLRESULT_FAILED;
    }
    if (topY < 0 || topY + sizeY > WORLD_H) {
        return TOOLRESULT_FAILED;
    }

    // Check whether the tiles are clear
    for (int dy = 0; dy < sizeY; dy++) {
        int posY = topY + dy;

        for (int dx = 0; dx < sizeX; dx++) {
            int posX = leftX + dx;

            unsigned short tileValue = effects->getMapTile(posX, posY);

            if (tileValue == DIRT) { // DIRT tile is buidable
                continue;
            }

            if (!autoBulldoze) {
                // No DIRT and no bull-dozer => not buildable
                return TOOLRESULT_NEED_BULLDOZE;
            }
            if (!tally(tileValue)) {
                // tilevalue cannot be auto-bulldozed
                return TOOLRESULT_NEED_BULLDOZE;
            }

            effects->setMapValue(posX, posY, DIRT);
            effects->addCost(gCostOf[TOOL_BULLDOZER]);
        }
    }

    return TOOLRESULT_OK;
}


/**
 * Build a building.
 * @param mapH          Horizontal position of the 'center' tile in the world.
 * @param mapV          Vertical position of the 'center' tile in the world.
 * @param buildingProps Building properties of the building being constructed.
 * @param effects       Storage of effects of putting down the building.
 * @return Tool result.
 *
 * @todo Give #putBuilding a #BuildingProperties pointer instead.
 * @todo Move cost into building properties?
 */
std::map<std::string, double> Micropolis::rescueOptions() const
{
    const int level = (int)rescueParam("rescuePressure");
    const bool fuelEmbargo = rescueEmbargo(1);
    const bool fuelBlocked = fuelEmbargo && level >= rescueParam("rescueAlternativeBlockLevel");
    const bool importBlocked = rescueEmbargo(2) && level >= rescueParam("rescueImportBlockLevel");
    const double multiplier = params.podsEnabled ? powerPlantCostMultiplier : 1.0;
    return {
        {"podConstructionCost", ceil(gCostOf[TOOL_INDUSTRIAL] * rescueConstructionFactor(5))},
        {"podDelayMonths", rescueEnabled() && rescueCrisis
            ? rescueParam("rescuePodDelayLevel" + std::to_string(level)) : 0.0},
        {"coalConstructionCost", ceil(gCostOf[TOOL_COALPOWER] * multiplier * rescueConstructionFactor(3))},
        {"nuclearConstructionCost", ceil(gCostOf[TOOL_NUCLEARPOWER] * multiplier * rescueConstructionFactor(4))},
        {"alternativeDelayMonths", fuelEmbargo && !fuelBlocked
            ? rescueParam("rescueAlternativeDelayLevel" + std::to_string(level)) : 0.0},
        {"coalBlocked", fuelBlocked ? 1.0 : 0.0},
        {"importUnitPrice", rescueImportPrice()},
        {"importBlocked", importBlocked ? 1.0 : 0.0},
        {"podPowerPerHuman", params.podPowerPerHuman},
        {"recycledFoodPerHuman", params.recycledFoodPerHuman},
        {"podsPerPlant", (double)params.podsPerPlant}
    };
}

ToolResult Micropolis::buildBuilding(int mapH, int mapV,
                                     const BuildingProperties *buildingProps,
                                     ToolEffects *effects)
{
    mapH--; mapV--; // Move position to top-left
    const bool alternative = buildingProps->tool == TOOL_COALPOWER || buildingProps->tool == TOOL_NUCLEARPOWER;
    if (rescueEmbargo(1) && alternative && !rescueCompletingConstruction &&
        rescueParam("rescuePressure") >= rescueParam("rescueAlternativeBlockLevel"))
        return TOOLRESULT_FAILED;
    if (rescueEmbargo(1) && alternative && !rescueCompletingConstruction) {
        const int delay = (int)rescueParam("rescueAlternativeDelayLevel" +
            std::to_string((int)rescueParam("rescuePressure")));
        if (delay > 0) {
            const int kind = buildingProps->tool == TOOL_COALPOWER ? 3 : 4;
            rescueConstructionQueue.push_back({kind, rescueMonth + delay,
                rescueConstructionFactor(kind), mapH + 1, mapV + 1});
            rescueQueuePending = (int)rescueConstructionQueue.size();
            return TOOLRESULT_OK;
        }
    }

    ToolResult prepareResult = prepareBuildingSite(mapH, mapV,
                                                buildingProps->sizeX,
                                                buildingProps->sizeY,
                                                effects);
    if (prepareResult != TOOLRESULT_OK) {
        return prepareResult;
    }

    /* Preparation was ok, put down the building. */
    if (rescueEnabled()) {
        const int kind = rescueBuildingPod ? 5 : buildingProps->tool == TOOL_COALPOWER ? 3 :
            buildingProps->tool == TOOL_NUCLEARPOWER ? 4 : -1;
        const double base = gCostOf[buildingProps->tool] * (alternative ? powerPlantCostMultiplier : 1.0);
        effects->addCost(kind >= 0 ? (int)ceil(base * rescueConstructionFactor(kind)) : gCostOf[buildingProps->tool]);
    } else {
        effects->addCost(gCostOf[buildingProps->tool]);
        if (params.podsEnabled && alternative)
            effects->addCost((int)(gCostOf[buildingProps->tool] * (powerPlantCostMultiplier - 1.0)));
    }

    putBuilding(mapH, mapV, buildingProps->sizeX, buildingProps->sizeY,
                buildingProps->baseTile, buildingProps->buildingIsAnimated,
                effects);

    checkBorder(mapH, mapV,
                buildingProps->sizeX, buildingProps->sizeY,
                effects);

    return TOOLRESULT_OK;
}


/* Query */

/* search table for zone status string match */
static short idArray[30] = {
    DIRT, RIVER, TREEBASE, RUBBLE,
    FLOOD, RADTILE, FIRE, ROADBASE,
    POWERBASE, RAILBASE, RESBASE, COMBASE,
    INDBASE, PORTBASE, AIRPORTBASE, COALBASE,
    FIRESTBASE, POLICESTBASE, STADIUMBASE, NUCLEARBASE,
    // FIXME: I think HBRDG_END should be HBRDG0...?
    HBRDG0, RADAR0, FOUNTAIN, INDBASE2, SOLARPOWERBASE,
    // FIXME: What are tiles 952 and 956?
    FOOTBALLGAME1, VBRDG0, 952, 956,
    9999, // a huge short
};

/*
    0, 2, 21, 44,
    48, 52, 53, 64,
    208, 224, 240, 423,
    612, 693, 709, 745,
    761, 770, 779, 811,
    827, 832, 840, 844,
    884, 932, 948, 952, 956

    Clear, Water, Trees, Rubble,
    Flood, Radioactive Waste, Fire, Road,
    Power, Rail, Residential, Commercial,
    Industrial, Port, AirPort, Coal Power,
    Fire Department, Police Department, Stadium, Nuclear Power,
    Draw Bridge, Radar Dish, Fountain, Industrial,
    Solar Power, 49er's 38  Bears 3, Draw Bridge, Ur 238, Unknown
*/


/**
 * Get string index for a status report on tile \a mapH, \a mapV on a
 * given status category.
 * @param catNo Category number:
 *  0: population density
 *  1: land value.
 *  2: crime rate.
 *  3: pollution.
 *  4: growth rate.
 * @param mapH  X coordinate of the tile.
 * @param mapV  Y coordinate of the tile.
 * @return Index into stri.202 file.
 */
int Micropolis::getDensity(short catNo, short mapH, short mapV)
{
    int z;

    switch (catNo) {

    case 0:
    default:
        z = populationDensityMap.worldGet(mapH, mapV);
        z = z >> 6;
        z = z & 3;
        return z + STR202_POPULATIONDENSITY_LOW;

    case 1:
        z = landValueMap.worldGet(mapH, mapV);
        if (z < 30) return STR202_LANDVALUE_SLUM;
        if (z < 80) return STR202_LANDVALUE_LOWER_CLASS;
        if (z < 150) return STR202_LANDVALUE_MIDDLE_CLASS;
        return STR202_LANDVALUE_HIGH_CLASS;

    case 2:
        z = crimeRateMap.worldGet(mapH, mapV);
        z = z >> 6;
        z = z & 3;
        return z + STR202_CRIME_NONE;

    case 3:
        z = pollutionDensityMap.worldGet(mapH, mapV);
        if (z < 64 && z > 0) return 13;
        z = z >> 6;
        z = z & 3;
        return z + STR202_POLLUTION_NONE;

    case 4:
        z = rateOfGrowthMap.worldGet(mapH, mapV);
        if (z < 0) return STR202_GROWRATE_DECLINING;
        if (z == 0) return STR202_GROWRATE_STABLE;
        if (z > 100) return STR202_GROWRATE_FASTGROWTH;
        return STR202_GROWRATE_SLOWGROWTH;

    }
}


/**
 * Report about the status of a tile.
 * @param mapH X coordinate of the tile.
 * @param mapV Y coordinate of the tile.
 * @bug Program breaks for status on 'dirt'
 */
void Micropolis::doZoneStatus(short mapH, short mapV)
{
    int tileCategory;
    int status[5];

    short tileNum = map[mapH][mapV] & LOMASK;

    if (tileNum >= COALSMOKE1 && tileNum < FOOTBALLGAME1) {
      tileNum = COALBASE;
    }

    // Find the category where the tile belongs to
    // Note: If 'tileNum < idArray[i]', it belongs to category i-1
    short i;
    for (i = 1; i < 29; i++) {
        if (tileNum < idArray[i]) {
            break;
        }
    }

    i--;
    // i contains the category that the tile belongs to (in theory 0..27).
    // The Solar Power plant adds one zone type to the existing status table.

    // FIXME: This needs to be fixed to support plug-in churches.

    // TODO: This should also return the bounding box and hot spot of
    // the zone to the user interface, as well as other interesting
    // information.

    // Code below looks buggy, 0 is a valid value (namely 'dirt'), and upper
    // limit is not correctly checked either ('stri.219' has only 27 lines).

    // FIXME: This is strange... Normalize to zero based index.
    if (i < 1 || i > 28) {
      i = 28;  // This breaks the program (when you click 'dirt')
    }

    // Obtain the string index of the tile category.
    // 'stri.219' has only 27 lines, so 0 <= i <= 26 is acceptable.
    tileCategory = i + 1;

    for (i = 0; i < 5; i++) {
        int id = clamp(getDensity(i, mapH, mapV) + 1, 1, 20);
        status[i] = id;
    }

    doShowZoneStatus(
        tileCategory,
        status[0], status[1], status[2],
        status[3], status[4], 
        mapH, mapV);
}


/** Tell front-end to report on status of a tile.
 * @param tileCategoryIndex         Category of the tile text index.
 * @param populationDensityIndex    Population density text index.
 * @param landValueIndex            Land value text index.
 * @param crimeRateIndex            Crime rate text index.
 * @param pollutionIndex            Pollution text index.
 * @param growthRateIndex           Grow rate text index.
 * @param x                         X coordinate of the tile.
 * @param y                         Y coordinate of the tile.
 */
void Micropolis::doShowZoneStatus(
    int tileCategoryIndex,
    int populationDensityIndex,
    int landValueIndex,
    int crimeRateIndex,
    int pollutionIndex,
    int growthRateIndex,
    int x,
    int y)
{
    callback->showZoneStatus(this, callbackVal, tileCategoryIndex, populationDensityIndex, landValueIndex, crimeRateIndex, pollutionIndex, growthRateIndex, x, y);
}


/**
 * Make a \a size by \a size tiles square of rubble
 * @param x    Horizontal position of the left-most tile
 * @param y    Vertical position of the left-most tile
 * @param size Size of the rubble square
 */
void Micropolis::putRubble(int x, int y, int size, ToolEffects *effects)
{
    for (int xx = x; xx < x + size; xx++) {
        for (int yy = y; yy < y + size; yy++)  {

            if (testBounds(xx, yy)) {
                int tile = effects->getMapTile(xx, yy);

                if (tile != RADTILE && tile != DIRT) {
                    tile = (doAnimation ? (TINYEXP + getRandom(2)) : SOMETINYEXP);
                    effects->setMapValue(xx, yy, tile | ANIMBIT | BULLBIT);
                }
            }
        }
    }
}


/**
 * Report to the front-end that a tool was used.
 * @param name: Name of the tool.
 * @param x     X coordinate of where the tool was applied.
 * @param y     Y coordinate of where the tool was applied.
 */
void Micropolis::didTool(std::string name, short x, short y)
{
    std::string json;
    json += "[";
    json += name;
    json += "\",";
    json += std::to_string(x);
    json += ",";
    json += std::to_string(y);
    json += "]";

    callback->didTool(this, callbackVal, name, x, y);
}


////////////////////////////////////////////////////////////////////////
// Tools


/**
 * Do query tool.
 * @param x X coordinate of the position of the query.
 * @param y Y coordinate of the position of the query.
 * @return Tool result.
 */
ToolResult Micropolis::queryTool(short x, short y)
{
    if (!testBounds(x, y)) {
        return TOOLRESULT_FAILED;
    }

    doZoneStatus(x, y);
    didTool("Qry", x, y);

    return TOOLRESULT_OK;
}

ToolResult Micropolis::bulldozerTool(short x, short y)
{
    ToolEffects effects(this);

    ToolResult result = bulldozerTool(x, y, &effects);

    if (result == TOOLRESULT_OK) {
        effects.modifyWorld();
    }

    return result;
}

/**
 * Apply bulldozer tool.
 * @param x X coordinate of the position of the query.
 * @param y Y coordinate of the position of the query.
 * @return Tool result.
 *
 * @todo Code is too complex/long.
 * @bug Tool does not return TOOLRESULT_NO_MONEY.
 * @bug Sometimes we can delete parts of a residential zone, but not always.
 *      Decide what rule we should have, and fix accordingly.
 *
 * @note Auto-bulldoze functionality is in Micropolis::prepareBuildingSite()
 */
ToolResult Micropolis::bulldozerTool(short x, short y, ToolEffects *effects)
{
    ToolResult result = TOOLRESULT_OK;

    if (!testBounds(x, y)) {
        return TOOLRESULT_FAILED;
    }

    MapValue mapVal = effects->getMapValue(x, y);
    if (params.podsEnabled && occupiedBioTile(x, y)) return TOOLRESULT_FAILED;
    MapTile tile = mapVal & LOMASK;

    short zoneSize = 0; // size of the zone, 0 means invalid.
    short deltaH; // Amount of horizontal shift to the center tile of the zone.
    short deltaV; // Amount of vertical shift to the center tile of the zone.
    FrontendMessage *frontendMsg;

    if (mapVal & ZONEBIT) { /* zone center bit is set */
        zoneSize = checkSize(tile);
        deltaH = 0;
        deltaV = 0;
    } else {
        zoneSize = checkBigZone(tile, &deltaH, &deltaV);
    }

    if (zoneSize > 0) {
        effects->addCost(gCostOf[TOOL_BULLDOZER]);

        int dozeX = x;
        int dozeY = y;
        int centerX = x + deltaH;
        int centerY = y + deltaV;

        switch (zoneSize) {

        case 3:
            frontendMsg = new FrontendMessageMakeSound(
                                "city", "Explosion-High", dozeX, dozeY);
            effects->addFrontendMessage(frontendMsg);

            putRubble(centerX - 1, centerY - 1, 3, effects);
            break;

        case 4:
            frontendMsg = new FrontendMessageMakeSound(
                                "city", "Explosion-Low", dozeX, dozeY);
            effects->addFrontendMessage(frontendMsg);

            putRubble(centerX - 1, centerY - 1, 4, effects);
            break;

        case 6:
            frontendMsg = new FrontendMessageMakeSound(
                                "city", "Explosion-High", dozeX, dozeY);
            effects->addFrontendMessage(frontendMsg);

            frontendMsg = new FrontendMessageMakeSound(
                                "city", "Explosion-Low", dozeX, dozeY);
            effects->addFrontendMessage(frontendMsg);

            putRubble(centerX - 1, centerY - 1, 6, effects);
            break;

        default:
            NOT_REACHED();
            break;

        }


        if (result == TOOLRESULT_OK) {
            /* send 'didtool' message */
            frontendMsg = new FrontendMessageDidTool("Dozr", x, y);
            effects->addFrontendMessage(frontendMsg);
        }

        return result;

    }


    if (tile == RIVER || tile == REDGE || tile == CHANNEL) {

        result = connectTile(x, y, CONNECT_TILE_BULLDOZE, effects);

        if (tile != effects->getMapTile(x, y)) {
            effects->addCost(5);
        }
    } else {
        result = connectTile(x, y, CONNECT_TILE_BULLDOZE, effects);
    }

    if (result == TOOLRESULT_OK) {
        /* send 'didtool' message */
        frontendMsg = new FrontendMessageDidTool("Dozr", x, y);
        didTool("Dozr", x, y);
        effects->addFrontendMessage(frontendMsg);
    }

    return result;
}


/**
 * Build a road at a tile.
 * @param x       Horizontal position of the tile to lay road.
 * @param y       Vertical position of the tile to lay road.
 * @param effects Storage of effects of laying raod at the tile.
 * @return Tool result.
 * @todo Merge roadTool, railroadTool, wireTool, and parkTool functions.
 */
ToolResult Micropolis::roadTool(short x, short y, ToolEffects *effects)
{
    if (!testBounds(x, y)) {
        return TOOLRESULT_FAILED;
    }

    ToolResult result = connectTile(x, y, CONNECT_TILE_ROAD, effects);

    if (result == TOOLRESULT_OK) {
        /* send 'didtool' message */
        FrontendMessage *didToolMsg;
        didToolMsg = new FrontendMessageDidTool("Road", x, y);
        effects->addFrontendMessage(didToolMsg);
    }

    return result;
}


/**
 * Build a rail track at a tile.
 * @param x       Horizontal position of the tile.
 * @param y       Vertical position of the tile.
 * @param effects Storage of effects of laying the rail.
 * @return Tool result.
 */
ToolResult Micropolis::railroadTool(short x, short y, ToolEffects *effects)
{
    if (!testBounds(x, y)) {
        return TOOLRESULT_FAILED;
    }

    ToolResult result = connectTile(x, y, CONNECT_TILE_RAILROAD, effects);

    if (result == TOOLRESULT_OK) {
        /* send 'didtool' message */
        FrontendMessage *didToolMsg;
        didToolMsg = new FrontendMessageDidTool("Rail", x, y);
        effects->addFrontendMessage(didToolMsg);
    }

    return result;
}


/**
 * Build a wire at a tile.
 * @param x       Horizontal position of the tile to wire.
 * @param y       Vertical position of the tile to wire.
 * @param effects Storage of effects of wiring the tile.
 * @return Tool result.
 */
ToolResult Micropolis::wireTool(short x, short y, ToolEffects *effects)
{
    if (!testBounds(x, y)) {
        return TOOLRESULT_FAILED;
    }

    ToolResult result = connectTile(x, y, CONNECT_TILE_WIRE, effects);

    if (result == TOOLRESULT_OK) {
        /* send 'didtool' message */
        FrontendMessage *didToolMsg;
        didToolMsg = new FrontendMessageDidTool("Wire", x, y);
        effects->addFrontendMessage(didToolMsg);
    }

    return result;
}


/**
 * Build a park.
 * @param x       Horizontal position of 'center tile' of the park.
 * @param y       Vertical position of 'center tile' of the park.
 * @param effects Storage of effects of putting down the park.
 * @return Tool result.
 */
ToolResult Micropolis::parkTool(short x, short y, ToolEffects *effects)
{
    if (!testBounds(x, y)) {
        return TOOLRESULT_FAILED;
    }

    ToolResult result = putDownPark(x, y, effects);

    if (result == TOOLRESULT_OK) {
        /* send 'didtool' message */
        FrontendMessage *didToolMsg;
        didToolMsg = new FrontendMessageDidTool("Park", x, y);
        effects->addFrontendMessage(didToolMsg);
    }

    return result;
}


/**
 * Build a building.
 * @param x             Horizontal position of center tile of the new building.
 * @param y             Vertical position of center tile of the new building.
 * @param buildingProps Building properties of the building being constructed.
 * @param effects       Storage of effects of putting down the building.
 * @return Tool result.
 */
ToolResult Micropolis::buildBuildingTool(short x, short y,
                                    const BuildingProperties *buildingProps,
                                    ToolEffects *effects)
{
    ToolResult result = buildBuilding(x, y, buildingProps, effects);

    if (result == TOOLRESULT_OK) {
        /* send 'didtool' message */
        FrontendMessage *didToolMsg;
        didToolMsg = new FrontendMessageDidTool(buildingProps->toolName, x, y);
        effects->addFrontendMessage(didToolMsg);
    }

    return result;
}

/** Building properties of a residential zone. */
static const BuildingProperties residentialZoneBuilding =
    BuildingProperties(3, 3, RESBASE, TOOL_RESIDENTIAL, "Res", false);

/** Building properties of a commercial zone. */
static const BuildingProperties commercialZoneBuilding =
    BuildingProperties(3, 3, COMBASE, TOOL_COMMERCIAL, "Com", false);

/** Building properties of a industrial zone. */
static const BuildingProperties industrialZoneBuilding =
    BuildingProperties(3, 3, INDBASE, TOOL_INDUSTRIAL, "Ind", false);

/** Building properties of a police station. */
static const BuildingProperties policeStationBuilding =
    BuildingProperties(3, 3, POLICESTBASE, TOOL_POLICESTATION, "Pol", false);

/** Building properties of a fire station. */
static const BuildingProperties fireStationBuilding =
    BuildingProperties(3, 3, FIRESTBASE, TOOL_FIRESTATION, "Fire", false);

/** Building properties of a stadium. */
static const BuildingProperties stadiumBuilding =
    BuildingProperties(4, 4, STADIUMBASE, TOOL_STADIUM, "Stad", false);

/** Building properties of a coal power station. */
static const BuildingProperties coalPowerBuilding =
    BuildingProperties(4, 4, COALBASE, TOOL_COALPOWER, "Coal", false);

/** Building properties of a nuclear power station. */
static const BuildingProperties nuclearPowerBuilding =
    BuildingProperties(4, 4, NUCLEARBASE, TOOL_NUCLEARPOWER, "Nuc", true);

/** Building properties of a solar power station. */
static const BuildingProperties solarPowerBuilding =
    BuildingProperties(4, 4, SOLARPOWERBASE, TOOL_SOLARPOWER, "Solar", false);

/** Building properties of a seaport. */
static const BuildingProperties seaportBuilding =
    BuildingProperties(4, 4, PORTBASE, TOOL_SEAPORT, "Seap", false);

/** Building properties of a airport. */
static const BuildingProperties airportBuilding =
    BuildingProperties(6, 6, AIRPORTBASE, TOOL_AIRPORT, "Airp", false);


/** Place owned zones/plants with non-destructive, atomically funded access. */
std::string Micropolis::getNetworkDiagnosticsJSON() const
{
    const int cells = WORLD_W * WORLD_H;
    const int dx[] = {-1, 0, 0, 1}, dy[] = {0, -1, 1, 0};
    const auto water = [](MapValue value) {
        const MapTile tile = value & LOMASK;
        return (tile >= RIVER && tile < TREEBASE) || tile == HBRIDGE || tile == VBRIDGE ||
            tile == HPOWER || tile == VPOWER;
    };
    std::vector<int> banks(cells, -1), islands(cells, -1), bankSizes;
    std::vector<int> search;
    for (int id = 0; id < cells; ++id) {
        if (banks[id] >= 0 || water(map[id / WORLD_H][id % WORLD_H])) continue;
        const int bank = (int)bankSizes.size();
        banks[id] = bank;
        search.assign(1, id);
        for (size_t head = 0; head < search.size(); ++head) {
            const int current = search[head], x = current / WORLD_H, y = current % WORLD_H;
            for (int d = 0; d < 4; ++d) {
                const int nx = x + dx[d], ny = y + dy[d];
                if (!testBounds(nx, ny)) continue;
                const int next = nx * WORLD_H + ny;
                if (banks[next] >= 0 || water(map[nx][ny])) continue;
                banks[next] = bank;
                search.push_back(next);
            }
        }
        bankSizes.push_back((int)search.size());
    }
    std::ostringstream out;
    out << "{\"banks\":[";
    for (size_t i = 0; i < bankSizes.size(); ++i) {
        if (i) out << ',';
        out << "{\"bankId\":" << i << ",\"landTiles\":" << bankSizes[i] << '}';
    }
    out << "],\"islands\":[";
    int island = 0;
    for (int id = 0; id < cells; ++id) {
        if (islands[id] >= 0 || !(map[id / WORLD_H][id % WORLD_H] & CONDBIT)) continue;
        islands[id] = island;
        search.assign(1, id);
        std::vector<int> bankIds;
        int zones = 0, powered = 0, humans = 0, ai = 0;
        double fuelCapacity = 0.0, capacity = 0.0;
        for (size_t head = 0; head < search.size(); ++head) {
            const int current = search[head], x = current / WORLD_H, y = current % WORLD_H;
            const MapValue value = map[x][y];
            const MapTile tile = value & LOMASK;
            if (banks[current] >= 0 && std::find(bankIds.begin(), bankIds.end(), banks[current]) == bankIds.end())
                bankIds.push_back(banks[current]);
            if (value & ZONEBIT) {
                ++zones;
                if (value & PWRBIT) ++powered;
                if (tile == POWERPLANT) fuelCapacity += COAL_POWER_STRENGTH;
                if (tile == NUCLEAR) fuelCapacity += NUCLEAR_POWER_STRENGTH;
                if (tile == SOLARPOWER) capacity += SOLAR_POWER_STRENGTH;
                if (tile >= RESBASE && tile < HOSPITAL) {
                    int population = tile == FREEZ ? doFreePop(Position(x, y)) : getResZonePop(tile);
                    if (rescueEnabled() || (params.podsEnabled && ownerMap.worldGet(x, y) != 2))
                        population = max(0, population - (int)humanPodOffsetMap.worldGet(x, y));
                    if (ownerMap.worldGet(x, y) == 2) ai += population;
                    else humans += population;
                }
            }
            for (int d = 0; d < 4; ++d) {
                const int nx = x + dx[d], ny = y + dy[d];
                if (!testBounds(nx, ny)) continue;
                const int next = nx * WORLD_H + ny;
                if (islands[next] >= 0 || !(map[nx][ny] & CONDBIT)) continue;
                islands[next] = island;
                search.push_back(next);
            }
        }
        capacity += floor(fuelCapacity * rescueFuelOutputFactor());
        double bioCapacity = 0.0;
        if (params.podsEnabled) for (const auto &plant : bioPlants) {
            if (islands[plant.x * WORLD_H + plant.y] != island ||
                !(map[plant.x][plant.y] & ZONEBIT) || ownerMap.worldGet(plant.x, plant.y) != plant.owner) continue;
            for (const auto &cohort : plant.cohorts) {
                const double age = cohort.age - (cohort.born ? params.podMaturityMonths : 0.0);
                if (age >= 0.0)
                    bioCapacity += cohort.count * params.podPowerPerHuman * max(0.0, 1.0 - age / params.podLifetimeMonths);
            }
        }
        capacity += floor(bioCapacity);
        const double aiDemand = floor(ai * params.aiPowerPerPop * (params.podsEnabled ? 1.0 - aiThrottle : 1.0));
        std::sort(bankIds.begin(), bankIds.end());
        if (island) out << ',';
        out << "{\"islandId\":" << island << ",\"bankIds\":[";
        for (size_t i = 0; i < bankIds.size(); ++i) { if (i) out << ','; out << bankIds[i]; }
        out << "],\"capacity\":" << capacity << ",\"bioCapacity\":" << bioCapacity
            << ",\"conductiveTiles\":" << search.size() << ",\"zones\":" << zones
            << ",\"physicalPoweredZones\":" << powered << ",\"humanPopulation\":" << humans
            << ",\"aiPopulation\":" << ai << ",\"aiDemand\":" << aiDemand
            << ",\"demand\":" << search.size() + aiDemand << '}';
        ++island;
    }
    out << "]}";
    return out.str();
}

int Micropolis::autoBuild(int kind, int count)
{
    return planAutoBuild(kind, count, false);
}

int Micropolis::getBuildSiteCount(int kind)
{
    const int previousFailure = autoBuildFailure;
    const int result = planAutoBuild(kind, 1, true);
    autoBuildFailure = previousFailure;
    return result;
}

int Micropolis::planAutoBuild(int kind, int count, bool inspect)
{
    autoBuildFailure = 0;
    const bool autonomous = kind == 6;
    const bool bio = kind == 5 || autonomous;
    if (kind < 0 || kind > 8 || (bio && !params.podsEnabled) ||
        (autonomous && (!params.aiFactionEnabled || !params.aiAutonomousPods || !aiAutonomyPermitted)) || count <= 0 || count > 1000) return 0;
    if (rescueEnabled() && autonomous && rescueParam("rescueFactionPressure") <= 0) return 0;
    if (rescueEmbargo(1) && (kind == 3 || kind == 4) && !rescueCompletingConstruction) {
        if (rescueParam("rescuePressure") >= rescueParam("rescueAlternativeBlockLevel")) {
            autoBuildFailure = 3;
            return 0;
        }
        const int delay = (int)rescueParam("rescueAlternativeDelayLevel" +
            std::to_string((int)rescueParam("rescuePressure")));
        if (delay > 0 && !inspect) {
            for (int i = 0; i < count; ++i)
                rescueConstructionQueue.push_back({kind, rescueMonth + delay, rescueConstructionFactor(kind)});
            rescueQueuePending = (int)rescueConstructionQueue.size();
            return count;
        }
    }

    const BuildingProperties *building = kind < 2 ? &residentialZoneBuilding
        : kind == 2 || bio ? &industrialZoneBuilding
        : kind == 3 ? &coalPowerBuilding : kind == 4 ? &nuclearPowerBuilding
        : kind == 7 ? &commercialZoneBuilding : &industrialZoneBuilding;
    const int size = building->sizeX;
    const int limit = params.foundingEnabled || kind == 3 || kind == 4 ? WORLD_W + WORLD_H : 12;
    const int cells = WORLD_W * WORLD_H;
    // Coordinate order also defines all BFS and placement ties.
    const int dx[] = {-1, 0, 0, 1};
    const int dy[] = {0, -1, 1, 0};
    const auto freeTerrain = [](MapValue value) {
        const MapTile tile = value & LOMASK;
        return !(value & (ZONEBIT | CONDBIT)) &&
            // LASTTREE ends the shoreline variants, not the forest range:
            // settled maps also use WOODS and WOODS2 through WOODS5.
            (tile == DIRT || (tile >= TREEBASE && tile <= WOODS5) ||
             (tile >= RUBBLE && tile <= LASTRUBBLE));
    };
    const auto roadTile = [](MapValue value) {
        const MapTile tile = value & LOMASK;
        return tile >= ROADBASE && tile < POWERBASE;
    };
    const auto waterTile = [](MapValue value) {
        const MapTile tile = value & LOMASK;
        return tile == RIVER || tile == REDGE || tile == CHANNEL;
    };
    const auto wireTerrain = [&](MapValue value) {
        if (freeTerrain(value) || (value & CONDBIT)) return true;
        MapTile tile = value & LOMASK;
        // layWire only accepts straight roads (including traffic variants).
        if (tile >= ROADBASE && tile < POWERBASE)
            tile = (tile & 15) + ROADBASE;
        return tile == ROADS || tile == ROADS2;
    };

    struct AutoBulldozeRestore {
        bool &flag;
        bool previous;
        ~AutoBulldozeRestore() { flag = previous; }
    } restore = {autoBulldoze, autoBulldoze};
    autoBulldoze = true;

    struct Candidate {
        int x, y, road, power, distance, neighbors, clearing;
        bool vacantZone;
        std::vector<int> roadPath, powerPath;
    };
    int built = 0;
    std::vector<unsigned char> counted(cells, 0);
    while (built < count) {
        if (!inspect && !autonomous && totalFunds < (rescueEnabled()
            ? ceil(gCostOf[building->tool] * rescueConstructionFactor(kind)) : gCostOf[building->tool])) {
            autoBuildFailure = 1;
            break;
        }
        bool fundingBlocked = false;
        bool hasRoad = false;

        // Stable physical connectivity, not a simulation power scan. Flood
        // through new zones/wires as well as old conductors, without changing
        // power maps, the scan stack, capacity accounting, or plant census.
        std::vector<unsigned char> connected(cells, 0);
        std::vector<int> queue;
        queue.reserve(cells);
        for (int x = 0; x < WORLD_W; ++x) {
            for (int y = 0; y < WORLD_H; ++y) {
                if (roadTile(map[x][y])) hasRoad = true;
                const MapTile tile = map[x][y] & LOMASK;
                const bool plant = params.foundingEnabled && (map[x][y] & ZONEBIT) &&
                    (tile == POWERPLANT || tile == NUCLEAR || tile == SOLARPOWER);
                if ((map[x][y] & CONDBIT) &&
                    ((map[x][y] & PWRBIT) || powerReachableMap.worldGet(x, y) || plant)) {
                    const int id = x * WORLD_H + y;
                    connected[id] = 1;
                    queue.push_back(id);
                }
            }
        }
        // Before the first generator, join the physically conductive (but
        // unpowered) founding lots. This does not grant power or scan capacity.
        const bool offGrid = params.foundingEnabled && queue.empty();
        if (offGrid) {
            for (int x = 0; x < WORLD_W; ++x)
                for (int y = 0; y < WORLD_H; ++y)
                    if (map[x][y] & CONDBIT) {
                        const int id = x * WORLD_H + y;
                        connected[id] = 1;
                        queue.push_back(id);
                    }
        }
        const bool seedConductor = offGrid && queue.empty();
        for (size_t head = 0; head < queue.size(); ++head) {
            const int x = queue[head] / WORLD_H, y = queue[head] % WORLD_H;
            for (int direction = 0; direction < 4; ++direction) {
                const int nx = x + dx[direction], ny = y + dy[direction];
                if (!testBounds(nx, ny)) continue;
                const int next = nx * WORLD_H + ny;
                if (!connected[next] && (map[nx][ny] & CONDBIT)) {
                    connected[next] = 1;
                    queue.push_back(next);
                }
            }
        }

        bool placed = false;
        bool hasWater = false;
        if (params.foundingEnabled) for (int x = 0; x < WORLD_W && !hasWater; ++x)
            for (int y = 0; y < WORLD_H; ++y)
                if (waterTile(map[x][y])) { hasWater = true; break; }
        for (int waterPass = 0; waterPass <= (hasWater ? 1 : 0); ++waterPass) {
        const bool allowWater = waterPass != 0;
        std::vector<int> roadDistance(cells, -1), roadParent(cells, -1);
        std::vector<int> powerDistance(cells, -1), powerParent(cells, -1);
        const auto advance = [&](int id, int direction, bool power, int &length) {
            const MapTile current = map[id / WORLD_H][id % WORLD_H] & LOMASK;
            if (params.foundingEnabled &&
                ((current == HBRIDGE || current == VPOWER) && dy[direction] != 0 ||
                 (current == VBRIDGE || current == HPOWER) && dx[direction] != 0)) return -1;
            int nx = id / WORLD_H + dx[direction], ny = id % WORLD_H + dy[direction];
            length = 1;
            if (allowWater) {
                while (testBounds(nx, ny) && waterTile(map[nx][ny])) {
                    nx += dx[direction]; ny += dy[direction]; ++length;
                }
            }
            if (!testBounds(nx, ny)) return -1;
            const MapValue value = map[nx][ny];
            const MapTile nextTile = value & LOMASK;
            if (params.foundingEnabled &&
                ((nextTile == HBRIDGE || nextTile == VPOWER) && dy[direction] != 0 ||
                 (nextTile == VBRIDGE || nextTile == HPOWER) && dx[direction] != 0)) return -1;
            if (!(power ? wireTerrain(value) : freeTerrain(value) || roadTile(value))) return -1;
            return nx * WORLD_H + ny;
        };
        const auto appendPath = [&](std::vector<int> &path, int id, const std::vector<int> &parent) {
            while (id >= 0) {
                path.push_back(id);
                const int previous = parent[id];
                if (previous >= 0) {
                    const int delta = previous / WORLD_H != id / WORLD_H
                        ? (previous > id ? WORLD_H : -WORLD_H) : (previous > id ? 1 : -1);
                    for (int step = id + delta; step != previous; step += delta) path.push_back(step);
                }
                id = previous;
            }
        };
        // Two global multi-source BFS passes per successful construction,
        // never a BFS for each possible footprint.
        const auto routeMap = [&](bool power, std::vector<int> &distance,
                                  std::vector<int> &parent) {
            queue.clear();
            for (int x = 0; x < WORLD_W; ++x) {
                for (int y = 0; y < WORLD_H; ++y) {
                    const int id = x * WORLD_H + y;
                    if (power ? connected[id] != 0 : roadTile(map[x][y])) {
                        distance[id] = 0;
                        queue.push_back(id);
                    }
                }
            }
            for (size_t head = 0; head < queue.size(); ++head) {
                const int id = queue[head];
                if (distance[id] >= limit) continue;
                const int x = id / WORLD_H, y = id % WORLD_H;
                for (int direction = 0; direction < 4; ++direction) {
                    int length;
                    const int next = advance(id, direction, power, length);
                    if (next < 0 || distance[id] + length > limit ||
                        (distance[next] >= 0 && distance[next] <= distance[id] + length)) continue;
                    distance[next] = distance[id] + length;
                    parent[next] = id;
                    queue.push_back(next);
                }
            }
        };
        routeMap(false, roadDistance, roadParent);
        routeMap(true, powerDistance, powerParent);

        std::vector<Candidate> candidates;
        for (int x = 0; x + size <= WORLD_W; ++x) {
            for (int y = 0; y + size <= WORLD_H; ++y) {
                const bool vacantZone = size == 3 &&
                    (map[x + 1][y + 1] & ZONEBIT) &&
                    (map[x + 1][y + 1] & LOMASK) == FREEZ &&
                    ownerMap.worldGet(x + 1, y + 1) == 0 &&
                    doFreePop(Position(x + 1, y + 1)) == 0;
                bool free = true;
                int clearing = 0;
                for (int bx = x; bx < x + size && free; ++bx) {
                    for (int by = y; by < y + size; ++by) {
                        if (!freeTerrain(map[bx][by]) && !(vacantZone &&
                            (map[bx][by] & LOMASK) >= RESBASE &&
                            (map[bx][by] & LOMASK) <= RESBASE + 8)) { free = false; break; }
                        if (!vacantZone && (map[bx][by] & LOMASK) != DIRT) ++clearing;
                    }
                }
                if (!free) continue;
                // Do not found the road grid on a coastal sliver that cannot
                // accommodate the next lot or a generator. Reserve terrain,
                // not tiles or money; subsequent lots use ordinary routing.
                if (params.foundingEnabled && !hasRoad) {
                    bool room = x >= 4 && y >= 4 &&
                        x + size + 4 <= WORLD_W && y + size + 4 <= WORLD_H;
                    for (int px = x - 4; room && px < x + size + 4; ++px)
                        for (int py = y - 4; py < y + size + 4; ++py)
                            if (!freeTerrain(map[px][py])) { room = false; break; }
                    if (!room) continue;
                }
                if (!inspect && !autonomous && totalFunds < (rescueEnabled()
                    ? ceil(gCostOf[building->tool] * rescueConstructionFactor(kind))
                    : gCostOf[building->tool]) + clearing + (vacantZone ? 1 : 0)) {
                    fundingBlocked = true;
                    continue;
                }

                // Every path must stay outside the building, including its
                // seed; a global shortest path may otherwise cut through it.
                const auto outside = [&](int id) {
                    const int px = id / WORLD_H, py = id % WORLD_H;
                    return px < x || px >= x + size || py < y || py >= y + size;
                };
                const auto bestEndpoint = [&](int id, int &best,
                                              const std::vector<int> &distance,
                                              const std::vector<int> &parent) {
                    if (distance[id] < 0 || distance[id] > limit) return;
                    if (best >= 0 && (distance[id] > distance[best] ||
                        (distance[id] == distance[best] && id >= best))) return;
                    for (int step = id; step >= 0; step = parent[step])
                        if (!outside(step)) return;
                    best = id;
                };
                int road = -1, power = -1, neighbors = 0;
                std::vector<int> roadPath;
                std::vector<int> edges;
                const auto perimeter = [&](int px, int py) {
                    if (!testBounds(px, py)) return;
                    const int id = px * WORLD_H + py;
                    edges.push_back(id);
                    if (map[px][py] & CONDBIT) ++neighbors;
                    bestEndpoint(id, road, roadDistance, roadParent);
                    bestEndpoint(id, power, powerDistance, powerParent);
                };
                // Cardinal edges only: no diagonal corner connections.
                for (int offset = 0; offset < size; ++offset) {
                    perimeter(x - 1, y + offset);
                    perimeter(x + size, y + offset);
                    perimeter(x + offset, y - 1);
                    perimeter(x + offset, y + size);
                }
                const auto findPath = [&](int &endpoint, bool power,
                                          const std::vector<int> &parent) {
                    std::vector<int> path;
                    if (endpoint >= 0) {
                        appendPath(path, endpoint, parent);
                        const bool overlap = power && std::any_of(path.begin(), path.end(), [&](int id) {
                            return waterTile(map[id / WORLD_H][id % WORLD_H]) &&
                                std::find(roadPath.begin(), roadPath.end(), id) != roadPath.end();
                        });
                        if (!overlap) return path;
                        path.clear();
                        endpoint = -1;
                    }
                    const std::vector<int> &globalDistance = power ? powerDistance : roadDistance;
                    if (std::none_of(edges.begin(), edges.end(), [&](int id) {
                        return globalDistance[id] >= 0;
                    })) return path;
                    // Global shortest-path parents can all cross this lot.
                    // Only then search from its edges with the footprint blocked.
                    std::vector<int> distance(cells, -1), previous(cells, -1);
                    std::vector<int> search;
                    std::sort(edges.begin(), edges.end());
                    for (int id : edges) {
                        const MapValue value = map[id / WORLD_H][id % WORLD_H];
                        if (distance[id] >= 0 || !(power ? wireTerrain(value)
                            : freeTerrain(value) || roadTile(value))) continue;
                        distance[id] = 0;
                        search.push_back(id);
                    }
                    for (size_t head = 0; head < search.size(); ++head) {
                        const int id = search[head];
                        const int px = id / WORLD_H, py = id % WORLD_H;
                        if (power ? connected[id] != 0 : roadTile(map[px][py])) {
                            appendPath(path, id, previous);
                            std::reverse(path.begin(), path.end());
                            endpoint = path.front();
                            return path;
                        }
                        if (distance[id] >= limit) continue;
                        for (int direction = 0; direction < 4; ++direction) {
                            int length;
                            const int next = advance(id, direction, power, length);
                            if (next < 0 || !outside(next) || distance[id] + length > limit ||
                                (distance[next] >= 0 && distance[next] <= distance[id] + length)) continue;
                            if (power && length > 1) {
                                const int delta = next / WORLD_H != px
                                    ? (next > id ? WORLD_H : -WORLD_H) : (next > id ? 1 : -1);
                                bool overlap = false;
                                for (int step = id + delta; step != next; step += delta)
                                    if (std::find(roadPath.begin(), roadPath.end(), step) != roadPath.end()) overlap = true;
                                if (overlap) continue;
                            }
                            distance[next] = distance[id] + length;
                            previous[next] = id;
                            search.push_back(next);
                        }
                    }
                    return path;
                };
                roadPath = findPath(road, false, roadParent);
                if (roadPath.empty() && params.foundingEnabled && !hasRoad) {
                    std::sort(edges.begin(), edges.end(), [&](int a, int b) {
                        const bool ad = (map[a / WORLD_H][a % WORLD_H] & LOMASK) == DIRT;
                        const bool bd = (map[b / WORLD_H][b % WORLD_H] & LOMASK) == DIRT;
                        return ad != bd ? ad : a < b;
                    });
                    for (int id : edges) {
                        if (freeTerrain(map[id / WORLD_H][id % WORLD_H])) {
                            road = id;
                            roadPath.push_back(id);
                            break;
                        }
                    }
                }
                if (roadPath.empty()) continue;
                if (params.foundingEnabled) {
                    // A lone access tile can be enclosed by the next lots.
                    // Keep a paid, connected road perimeter open for expansion.
                    bool access = true;
                    for (int px = x - 1; px <= x + size && access; ++px)
                        for (int py = y - 1; py <= y + size; ++py) {
                            if (px >= x && px < x + size && py >= y && py < y + size) continue;
                            if (!testBounds(px, py)) { access = false; break; }
                            const MapValue value = map[px][py];
                            if (!freeTerrain(value) && !roadTile(value)) { access = false; break; }
                            const int id = px * WORLD_H + py;
                            if (std::find(roadPath.begin(), roadPath.end(), id) == roadPath.end())
                                roadPath.push_back(id);
                        }
                    if (!access) continue;
                    if (!hasRoad) {
                        for (int id : roadPath)
                            if ((map[id / WORLD_H][id % WORLD_H] & LOMASK) != DIRT) ++clearing;
                    }
                }
                std::vector<int> powerPath = findPath(power, true, powerParent);
                if (powerPath.empty() && !seedConductor) continue;
                candidates.push_back({x, y, road, power,
                    static_cast<int>(roadPath.size() + powerPath.size()) - 2,
                    neighbors, clearing, vacantZone, roadPath, powerPath});
            }
        }
        std::sort(candidates.begin(), candidates.end(),
            [](const Candidate &a, const Candidate &b) {
                if (a.distance != b.distance) return a.distance < b.distance;
                if (a.neighbors != b.neighbors) return a.neighbors > b.neighbors;
                if (a.clearing != b.clearing) return a.clearing < b.clearing;
                if (a.x != b.x) return a.x < b.x;
                return a.y < b.y;
            });

        for (const Candidate &candidate : candidates) {
            if (inspect && counted[candidate.x * WORLD_H + candidate.y]) continue;
            ToolEffects effects(this);
            const auto stagePath = [&](const std::vector<int> &path, bool power) {
                // Work outward from existing infrastructure so tools see
                // previous staged neighbors, not just the unmodified map.
                for (auto step = path.rbegin(); step != path.rend(); ++step) {
                    const int px = *step / WORLD_H, py = *step % WORLD_H;
                    MapValue value = effects.getMapValue(px, py);
                    if (power ? (value & CONDBIT) != 0 : roadTile(value)) continue;
                    if (!(power ? wireTerrain(value) : freeTerrain(value)) &&
                        !(allowWater && waterTile(value))) return false;
                    const MapTile tile = value & LOMASK;
                    if ((tile >= TREEBASE && tile <= WOODS5) ||
                        (tile >= RUBBLE && tile <= LASTRUBBLE)) {
                        effects.setMapValue(px, py, DIRT);
                        effects.addCost(gCostOf[TOOL_BULLDOZER]);
                    }
                    const ToolResult result = power ? wireTool(px, py, &effects)
                                                    : roadTool(px, py, &effects);
                    if (result != TOOLRESULT_OK) return false;
                    if (waterTile(value)) {
                        const MapTile laid = effects.getMapTile(px, py);
                        const auto adjacent = step + 1;
                        if (adjacent == path.rend()) return false;
                        const bool horizontal = *adjacent / WORLD_H != px;
                        if (power ? laid != (horizontal ? VPOWER : HPOWER)
                                  : laid != (horizontal ? HBRIDGE : VBRIDGE)) return false;
                    }
                }
                return true;
            };
            if (!stagePath(candidate.roadPath, false) ||
                !stagePath(candidate.powerPath, true)) continue;
            const int centerX = candidate.x + 1, centerY = candidate.y + 1;
            if (candidate.vacantZone) {
                // Reuse an entirely uninhabited zoned lot, never evict houses.
                for (int px = candidate.x; px < candidate.x + size; ++px)
                    for (int py = candidate.y; py < candidate.y + size; ++py)
                        effects.setMapValue(px, py, DIRT);
                effects.addCost(gCostOf[TOOL_BULLDOZER]);
            }
            const bool priorCompleting = rescueCompletingConstruction;
            const double priorFactor = rescueCompletionCostFactor;
            if (inspect) {
                rescueCompletionCostFactor = rescueConstructionFactor(kind);
                rescueCompletingConstruction = true;
            }
            rescueBuildingPod = rescueEnabled() && bio;
            const ToolResult buildingResult = buildBuildingTool(centerX, centerY, building, &effects);
            rescueBuildingPod = false;
            rescueCompletingConstruction = priorCompleting;
            rescueCompletionCostFactor = priorFactor;
            if (buildingResult != TOOLRESULT_OK)
                continue;
            if (inspect) {
                counted[candidate.x * WORLD_H + candidate.y] = 1;
                ++built;
                continue;
            }
            // Clearing, both routes, and the building share one transaction.
            // Failed tools or funding leave the entire world untouched.
            if (autonomous) {
                effects.waiveCost();
                effects.modifyWorld();
            } else if (!effects.modifyIfEnoughFunding()) {
                fundingBlocked = true;
                continue;
            }
            if (kind < 3 || bio) {
                setZoneOwner(centerX, centerY, kind == 0 ? 1 : kind == 1 ? 2 : bio ? autonomous ? 5 : 4 : 3);
                if (bio) bioPlants.push_back({centerX, centerY, 0.0, 0.0, {}, (Byte)(autonomous ? 5 : 4)});
                if (bio) {
                    for (int px = candidate.x; px < candidate.x + size; ++px)
                        for (int py = candidate.y; py < candidate.y + size; ++py)
                            map[px][py] &= ~BURNBIT;
                }
                if (kind == 1) {
                    if (params.aiFactionEnabled) ++pendingNewAiZones;
                    for (int px = candidate.x; px < candidate.x + size; ++px)
                        for (int py = candidate.y; py < candidate.y + size; ++py)
                            aiHouseMap.worldSet(px, py, 0);
                }
            }
            ++built;
            if (bio && params.aiFactionEnabled) refreshPods();
            placed = true;
            break;
        }
        if (placed) break;
        }
        if (inspect) return built;
        if (!placed) {
            autoBuildFailure = fundingBlocked ? 1 : 2;
            break;
        }
    }
    return built;
}


/**
 * Put down a network.
 * @todo Is this ever used?
 */
ToolResult Micropolis::networkTool(short x, short y, ToolEffects *effects)
{
    if (!testBounds(x, y)) {
        return TOOLRESULT_FAILED;
    }

    ToolResult result = putDownNetwork(x, y, effects);

    if (result == TOOLRESULT_OK) {
        /* send 'didtool' message */
        FrontendMessage *didToolMsg;
        didToolMsg = new FrontendMessageDidTool("Net", x, y);
        effects->addFrontendMessage(didToolMsg);
    }

    return result;
}


ToolResult Micropolis::waterTool(short x, short y, ToolEffects *effects)
{
    if (!testBounds(x, y)) {
        return TOOLRESULT_FAILED;
    }

    ToolResult result = bulldozerTool(x, y, effects);

    if (result == TOOLRESULT_OK) {
        result = putDownWater(x, y, effects);
    }

    if (result == TOOLRESULT_OK) {
        /* send 'didtool' message */
        FrontendMessage *didToolMsg;
        didToolMsg = new FrontendMessageDidTool("Water", x, y);
        effects->addFrontendMessage(didToolMsg);
    }

    return result;
}


ToolResult Micropolis::landTool(short x, short y, ToolEffects *effects)
{
    if (!testBounds(x, y)) {
        return TOOLRESULT_FAILED;
    }

    /// @todo: Is this good? It is not auto-bulldoze!!
    /// @todo: Handle result value (probably)
    ToolResult result = bulldozerTool(x, y, effects);

    result = putDownLand(x, y, effects);

    if (result == TOOLRESULT_OK) {
        /* send 'didtool' message */
        FrontendMessage *didToolMsg;
        didToolMsg = new FrontendMessageDidTool("Land", x, y);
        effects->addFrontendMessage(didToolMsg);
    }

    return result;
}


ToolResult Micropolis::forestTool(short x, short y, ToolEffects *effects)
{
    ToolResult result = TOOLRESULT_OK;

    if (!testBounds(x, y)) {
        return TOOLRESULT_FAILED;
    }

    MapValue tile = effects->getMapValue(x, y);

    if (isTree(tile)) {
        return TOOLRESULT_OK;
    }

    if ((tile & LOMASK) != DIRT) {
        /// @todo bulldozer should be free in terrain mode or from a free tool.
        result = bulldozerTool(x, y, effects);
    }

    tile = effects->getMapValue(x, y);

    if (tile == DIRT) {
        result = putDownForest(x, y, effects);

        if (result == TOOLRESULT_OK) {
            /* send 'didtool' message */
            FrontendMessage *didToolMsg;
            didToolMsg = new FrontendMessageDidTool("Forest", x, y);
            effects->addFrontendMessage(didToolMsg);
        }

    } else {
        result = TOOLRESULT_FAILED;
    }

    return result;
}


/**
 * Apply a tool.
 * @param tool  Tool to use.
 * @param tileX Horizontal position in the city map.
 * @param tileY Vertical position in the city map.
 * @return Tool result.
 */
ToolResult Micropolis::doTool(EditingTool tool, short tileX, short tileY)
{
    ToolEffects effects(this);
    ToolResult result;

    switch (tool) {

    case TOOL_RESIDENTIAL:
        result = buildBuildingTool(tileX, tileY, &residentialZoneBuilding,
                                   &effects);
        break;

    case TOOL_COMMERCIAL:
        result = buildBuildingTool(tileX, tileY, &commercialZoneBuilding,
                                   &effects);
        break;

    case TOOL_INDUSTRIAL:
        result = buildBuildingTool(tileX, tileY, &industrialZoneBuilding,
                                   &effects);
        break;

    case TOOL_FIRESTATION:
        result = buildBuildingTool(tileX, tileY, &fireStationBuilding,
                                   &effects);
        break;

    case TOOL_POLICESTATION:
        result = buildBuildingTool(tileX, tileY, &policeStationBuilding,
                                   &effects);
        break;

    case TOOL_QUERY:
        return queryTool(tileX, tileY);

    case TOOL_WIRE:
        result = wireTool(tileX, tileY, &effects);
        break;

    case TOOL_BULLDOZER:
        result = bulldozerTool(tileX, tileY, &effects);
        break;

    case TOOL_RAILROAD:
        result = railroadTool(tileX, tileY, &effects);
        break;

    case TOOL_ROAD:
        result = roadTool(tileX, tileY, &effects);
        break;

    case TOOL_STADIUM:
        result = buildBuildingTool(tileX, tileY, &stadiumBuilding,
                                   &effects);
        break;

    case TOOL_PARK:
        result = parkTool(tileX, tileY, &effects);
        break;

    case TOOL_SEAPORT:
        result = buildBuildingTool(tileX, tileY, &seaportBuilding,
                                   &effects);
        break;

    case TOOL_COALPOWER:
        result = buildBuildingTool(tileX, tileY, &coalPowerBuilding,
                                   &effects);
        break;

    case TOOL_NUCLEARPOWER:
        result = buildBuildingTool(tileX, tileY, &nuclearPowerBuilding,
                                   &effects);
        break;

    case TOOL_AIRPORT:
        result = buildBuildingTool(tileX, tileY, &airportBuilding,
                                   &effects);
        break;

    case TOOL_NETWORK:
        result = networkTool(tileX, tileY, &effects);
        break;

    case TOOL_WATER:
        result = waterTool(tileX, tileY, &effects);
        break;

    case TOOL_LAND:
        result = landTool(tileX, tileY, &effects);
        break;

    case TOOL_FOREST:
        result = forestTool(tileX, tileY, &effects);
        break;

    case TOOL_SOLARPOWER:
        result = buildBuildingTool(tileX, tileY, &solarPowerBuilding,
                                   &effects);
        break;

    default:
        return TOOLRESULT_FAILED;

    }

    // Perform the effects of applying the tool if enough funds.
    if (result == TOOLRESULT_OK) {
        if (!effects.modifyIfEnoughFunding()) {
            return TOOLRESULT_NO_MONEY;
        }
    }

    return result;
}


void Micropolis::toolDown(EditingTool tool, short tileX, short tileY)
{
    ToolResult result = doTool(tool, tileX, tileY);

    if (result == TOOLRESULT_NEED_BULLDOZE) {
        sendMessage(MESSAGE_BULLDOZE_AREA_FIRST, NOWHERE, NOWHERE, false, true);
        /// @todo: Multi player: This sound should only be heard by the user
        ///        who called this function.
        makeSound("interface", "UhUh", tileX <<4, tileY <<4);

    } else if (result == TOOLRESULT_NO_MONEY) {
        sendMessage(MESSAGE_NOT_ENOUGH_FUNDS, NOWHERE, NOWHERE, false, true);
        /// @todo: Multi player: This sound should only be heard by the user
        ///        who called this function.
        makeSound("interface", "Sorry", tileX <<4, tileY <<4);
    }

    simPass = 0;
    invalidateMaps();
}

/**
 * Drag a tool from (\a fromX, \a fromY) to (\a toX, \a toY).
 * @param tool Tool being dragged.
 * @param fromX Horizontal coordinate of the starting position.
 * @param fromY Vertical coordinate of the starting position.
 * @param toX Horizontal coordinate of the ending position.
 * @param toY Vertical coordinate of the ending position.
 */
void Micropolis::toolDrag(EditingTool tool,
                            short fromX, short fromY, short toX, short toY)
{
    // Do not drag big tools.
    int toolSize = gToolSize[tool];
    if (toolSize > 1) {
        doTool(tool, toX, toY);

        simPass = 0; // update editors overlapping this one
        invalidateMaps();
        return;
    }

    short dirX = (toX > fromX) ? 1 : -1; // Horizontal step direction.
    short dirY = (toY > fromY) ? 1 : -1; // Vertical step direction.


    if (fromX == toX && fromY == toY) {
        return;
    }

    doTool(tool, fromX, fromY); // Ensure the start position is done.

    // Vertical line up or down
    if (fromX == toX && fromY != toY) {

        while (fromY != toY) {
            fromY += dirY;
            doTool(tool, fromX, fromY);
        }

        simPass = 0; // update editors overlapping this one
        invalidateMaps();
        return;
    }

    // Horizontal line left/right
    if (fromX != toX && fromY == toY) {

        while (fromX != toX) {
            fromX += dirX;
            doTool(tool, fromX, fromY);
        }

        simPass = 0; // update editors overlapping this one
        invalidateMaps();
        return;
    }

    // General case: both X and Y change.

    short dx = absoluteValue(fromX - toX); // number of horizontal steps.
    short dy = absoluteValue(fromY - toY); // number of vertical steps.

    short subX = 0; // Each X step is dy sub-steps.
    short subY = 0; // Each Y step is dx sub-steps.
    short numSubsteps = min(dx, dy); // Number of sub-steps we can do.

    while (fromX != toX || fromY != toY) {
        subX += numSubsteps;
        if (subX >= dy) {
            subX -= dy;
            fromX += dirX;
            doTool(tool, fromX, fromY);
        }

        subY += numSubsteps;
        if (subY >= dx) {
            subY -= dx;
            fromY += dirY;
            doTool(tool, fromX, fromY);
        }
    }

    simPass = 0;
    invalidateMaps();
}


////////////////////////////////////////////////////////////////////////
