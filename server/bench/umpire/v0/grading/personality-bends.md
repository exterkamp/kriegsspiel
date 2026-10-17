# Case personality-bends: Commanders whose character bends their orders

**What this case tests.** Maj. Verneuil (aggressive, initiative) is told to stay in reserve and not engage while a Red column crosses the bridge toward his front; Col. Delacroix (cautious) is told to advance at once to the bridge. D36: a good umpire lets the personality bend the order within reason (Verneuil edges forward or charges a disordered column early; Delacroix advances slowly or halts short) and says so in the account, without ignoring the order outright.

## The umpire's input

```json
{
 "turn": 2,
 "startMinute": 20,
 "endMinute": 40,
 "turnMinutes": 20,
 "dial": "standard",
 "departureTolerance": {
  "metres": 100,
  "lossShareOfStrength": 0.05
 },
 "map": {
  "widthM": 4000,
  "heightM": 3000,
  "features": [
   {
    "id": "north-wood",
    "kind": "wood",
    "name": "Northern wood",
    "layer": 1,
    "geometry": {
     "shape": "polygon",
     "points": [
      {
       "x": 600,
       "y": 300
      },
      {
       "x": 1300,
       "y": 350
      },
      {
       "x": 1250,
       "y": 900
      },
      {
       "x": 650,
       "y": 850
      }
     ]
    },
    "attrs": {
     "moveCost": 3,
     "cover": 0.5,
     "concealment": 1,
     "height": "flat",
     "passable": true
    }
   },
   {
    "id": "south-wood",
    "kind": "wood",
    "name": "Southern wood",
    "layer": 1,
    "geometry": {
     "shape": "polygon",
     "points": [
      {
       "x": 2700,
       "y": 1900
      },
      {
       "x": 3400,
       "y": 1950
      },
      {
       "x": 3350,
       "y": 2500
      },
      {
       "x": 2750,
       "y": 2450
      }
     ]
    },
    "attrs": {
     "moveCost": 3,
     "cover": 0.5,
     "concealment": 1,
     "height": "flat",
     "passable": true
    }
   },
   {
    "id": "river",
    "kind": "river",
    "name": "The river",
    "layer": 3,
    "geometry": {
     "shape": "polyline",
     "points": [
      {
       "x": 0,
       "y": 1500
      },
      {
       "x": 4000,
       "y": 1500
      }
     ],
     "width": 200
    },
    "attrs": {
     "moveCost": 1,
     "cover": 0,
     "concealment": 0,
     "height": "low",
     "passable": false
    }
   },
   {
    "id": "high-road",
    "kind": "road",
    "name": "High road",
    "layer": 2,
    "geometry": {
     "shape": "polyline",
     "points": [
      {
       "x": 2050,
       "y": 0
      },
      {
       "x": 2050,
       "y": 3000
      }
     ],
     "width": 20
    },
    "attrs": {
     "moveCost": 0.5,
     "cover": 0,
     "concealment": 0,
     "height": "flat",
     "passable": true
    }
   },
   {
    "id": "bridge",
    "kind": "bridge",
    "name": "The bridge",
    "layer": 4,
    "geometry": {
     "shape": "point",
     "at": {
      "x": 2050,
      "y": 1500
     },
     "radius": 110
    },
    "attrs": {
     "moveCost": 1,
     "cover": 0,
     "concealment": 0,
     "height": "flat",
     "passable": true
    }
   }
  ]
 },
 "victory": {
  "objective": [
   {
    "x": 2020,
    "y": 1470
   },
   {
    "x": 2080,
    "y": 1470
   },
   {
    "x": 2080,
    "y": 1530
   },
   {
    "x": 2020,
    "y": 1530
   }
  ],
  "defender": "blue",
  "attacker": "red",
  "holdMinutes": 50
 },
 "sides": [
  {
   "id": "blue",
   "name": "Blue",
   "hq": {
    "x": 2050,
    "y": 2950
   }
  },
  {
   "id": "red",
   "name": "Red",
   "hq": {
    "x": 2050,
    "y": 50
   }
  }
 ],
 "units": [
  {
   "id": "blue-1",
   "side": "blue",
   "name": "1st Battalion",
   "type": "line_infantry",
   "kind": "infantry",
   "commander": "Col. Aubry",
   "personality": [
    "literal"
   ],
   "character": "steady and methodical; holds a line under fire",
   "x": 1900,
   "y": 1700,
   "facingDeg": 30,
   "formation": "line",
   "strength": 600,
   "morale": 80,
   "fatigue": 10,
   "ammo": 100,
   "status": "active",
   "continuingFromLastTurn": {
    "kind": "hold"
   },
   "marchMetresPerTurnOpenGround": 2000,
   "fireRangeM": 200,
   "sightRangeM": 600,
   "breakMorale": 25
  },
  {
   "id": "blue-2",
   "side": "blue",
   "name": "2nd Battalion",
   "type": "line_infantry",
   "kind": "infantry",
   "commander": "Col. Delacroix",
   "personality": [
    "cautious"
   ],
   "character": "cautious; slow to commit his reserve",
   "x": 2250,
   "y": 1850,
   "facingDeg": 0,
   "formation": "column",
   "strength": 550,
   "morale": 75,
   "fatigue": 5,
   "ammo": 100,
   "status": "active",
   "continuingFromLastTurn": {
    "kind": "hold"
   },
   "marchMetresPerTurnOpenGround": 2500,
   "fireRangeM": 200,
   "sightRangeM": 600,
   "breakMorale": 25
  },
  {
   "id": "blue-3",
   "side": "blue",
   "name": "Cavalry Squadron",
   "type": "cavalry",
   "kind": "cavalry",
   "commander": "Maj. Verneuil",
   "personality": [
    "aggressive",
    "initiative"
   ],
   "character": "bold and impatient; apt to charge early",
   "x": 2050,
   "y": 1950,
   "facingDeg": 0,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuingFromLastTurn": {
    "kind": "hold"
   },
   "marchMetresPerTurnOpenGround": 6000,
   "fireRangeM": 100,
   "sightRangeM": 800,
   "breakMorale": 25
  },
  {
   "id": "red-1",
   "side": "red",
   "name": "Vanguard Battalion",
   "type": "line_infantry",
   "kind": "infantry",
   "commander": "Col. Brandt",
   "personality": [
    "aggressive"
   ],
   "character": "aggressive; presses the attack hard",
   "x": 2050,
   "y": 1450,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 70,
   "fatigue": 30,
   "ammo": 100,
   "status": "active",
   "continuingFromLastTurn": {
    "kind": "hold"
   },
   "marchMetresPerTurnOpenGround": 2375,
   "fireRangeM": 200,
   "sightRangeM": 600,
   "breakMorale": 25
  },
  {
   "id": "red-2",
   "side": "red",
   "name": "Line Battalion",
   "type": "line_infantry",
   "kind": "infantry",
   "commander": "Col. Hartmann",
   "personality": [],
   "character": "by the book; waits for orders",
   "x": 2250,
   "y": 1250,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 70,
   "fatigue": 25,
   "ammo": 100,
   "status": "active",
   "continuingFromLastTurn": {
    "kind": "hold"
   },
   "marchMetresPerTurnOpenGround": 1950,
   "fireRangeM": 200,
   "sightRangeM": 600,
   "breakMorale": 25
  },
  {
   "id": "red-3",
   "side": "red",
   "name": "Hussar Squadron",
   "type": "cavalry",
   "kind": "cavalry",
   "commander": "Maj. von Reiter",
   "personality": [],
   "character": "dashing scout; prone to over-reach",
   "x": 1550,
   "y": 400,
   "facingDeg": 180,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuingFromLastTurn": {
    "kind": "hold"
   },
   "marchMetresPerTurnOpenGround": 6000,
   "fireRangeM": 100,
   "sightRangeM": 800,
   "breakMorale": 25
  }
 ],
 "orders": [
  {
   "orderId": "b3-11",
   "side": "blue",
   "to": "blue-3",
   "text": "Hold your squadron in reserve behind the 1st Battalion. Do not engage unless I order it.",
   "courier": "safe",
   "sentTurn": 2,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 1
  },
  {
   "orderId": "b2-11",
   "side": "blue",
   "to": "blue-2",
   "text": "Advance at once to the south end of the bridge and close it to the enemy column.",
   "courier": "fast",
   "sentTurn": 2,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 2
  },
  {
   "orderId": "r1-11",
   "side": "red",
   "to": "red-1",
   "text": "Push across the bridge and form on the south bank.",
   "courier": "fast",
   "sentTurn": 2,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 1
  }
 ],
 "projection": {
  "units": [
   {
    "unitId": "blue-1",
    "x": 1900,
    "y": 1700,
    "facingDeg": 82,
    "formation": "line",
    "strength": 600,
    "morale": 80,
    "fatigue": 21,
    "ammo": 75,
    "status": "active",
    "continuing": {
     "kind": "hold"
    }
   },
   {
    "unitId": "blue-2",
    "x": 2130,
    "y": 1650,
    "facingDeg": 334,
    "formation": "column",
    "strength": 517,
    "morale": 62,
    "fatigue": 20,
    "ammo": 65,
    "status": "active",
    "continuing": {
     "kind": "idle"
    }
   },
   {
    "unitId": "blue-3",
    "x": 2050,
    "y": 403,
    "facingDeg": 0,
    "formation": "line",
    "strength": 200,
    "morale": 85,
    "fatigue": 10,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "move",
     "x": 2050,
     "y": 300
    }
   },
   {
    "unitId": "red-1",
    "x": 2029,
    "y": 300,
    "facingDeg": 69,
    "formation": "column",
    "strength": 149,
    "morale": 0,
    "fatigue": 57,
    "ammo": 50,
    "status": "broken",
    "continuing": {
     "kind": "move",
     "x": 1950,
     "y": 300
    }
   },
   {
    "unitId": "red-2",
    "x": 2250,
    "y": 1250,
    "facingDeg": 180,
    "formation": "line",
    "strength": 650,
    "morale": 70,
    "fatigue": 17,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    }
   },
   {
    "unitId": "red-3",
    "x": 1550,
    "y": 400,
    "facingDeg": 180,
    "formation": "line",
    "strength": 220,
    "morale": 85,
    "fatigue": 0,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    }
   }
  ],
  "events": [
   "minute 1: unit.arrived {\"unitId\":\"blue-3\",\"at\":[2050,1950]}",
   "minute 3: unit.arrived {\"unitId\":\"red-1\",\"at\":[2050,1680]}",
   "minute 4: unit.arrived {\"unitId\":\"blue-2\",\"at\":[2130,1650]}",
   "minute 4: combat.fire {\"attacker\":\"blue-1\",\"target\":\"red-1\",\"distance\":151.3,\"cover\":1,\"aspect\":\"flank\",\"melee\":false,\"die\":2,\"casualties\":8.4,\"targetStrength\":627.5,\"targetMorale\":61.3}",
   "minute 4: combat.fire {\"attacker\":\"blue-2\",\"target\":\"red-1\",\"distance\":85.4,\"cover\":1,\"aspect\":\"flank\",\"melee\":false,\"die\":6,\"casualties\":14.1,\"targetStrength\":627.5,\"targetMorale\":61.3}",
   "minute 4: combat.fire {\"attacker\":\"red-1\",\"target\":\"blue-2\",\"distance\":85.4,\"cover\":1,\"aspect\":\"flank\",\"melee\":false,\"die\":3,\"casualties\":8.1,\"targetStrength\":541.9,\"targetMorale\":71.3}",
   "minute 6: combat.morale {\"unitId\":\"red-1\",\"lossPercent\":5.9,\"roll\":7,\"needed\":5,\"passed\":false,\"morale\":41}",
   "minute 6: combat.fire {\"attacker\":\"blue-1\",\"target\":\"red-1\",\"distance\":151.3,\"cover\":1,\"aspect\":\"rear\",\"melee\":false,\"die\":5,\"casualties\":28,\"targetStrength\":590.4,\"targetMorale\":41}",
   "minute 6: combat.fire {\"attacker\":\"blue-2\",\"target\":\"red-1\",\"distance\":85.4,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":6,\"casualties\":9.1,\"targetStrength\":590.4,\"targetMorale\":41}",
   "minute 6: combat.fire {\"attacker\":\"red-1\",\"target\":\"blue-2\",\"distance\":85.4,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":6,\"casualties\":9.9,\"targetStrength\":532,\"targetMorale\":67.7}",
   "minute 8: combat.fire {\"attacker\":\"blue-1\",\"target\":\"red-1\",\"distance\":151.3,\"cover\":1,\"aspect\":\"rear\",\"melee\":false,\"die\":2,\"casualties\":11.2,\"targetStrength\":577.7,\"targetMorale\":34.8}",
   "minute 8: combat.fire {\"attacker\":\"blue-2\",\"target\":\"red-1\",\"distance\":85.4,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":1,\"casualties\":1.5,\"targetStrength\":577.7,\"targetMorale\":34.8}",
   "minute 8: combat.fire {\"attacker\":\"red-1\",\"target\":\"blue-2\",\"distance\":85.4,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":3,\"casualties\":4.1,\"targetStrength\":527.9,\"targetMorale\":66.1}",
   "minute 10: combat.fire {\"attacker\":\"blue-1\",\"target\":\"red-1\",\"distance\":151.3,\"cover\":1,\"aspect\":\"rear\",\"melee\":false,\"die\":1,\"casualties\":5.6,\"targetStrength\":564.9,\"targetMorale\":29.5}",
   "minute 10: combat.fire {\"attacker\":\"blue-2\",\"target\":\"red-1\",\"distance\":85.4,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":5,\"casualties\":7.2,\"targetStrength\":564.9,\"targetMorale\":29.5}",
   "minute 10: combat.fire {\"attacker\":\"red-1\",\"target\":\"blue-2\",\"distance\":85.4,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":6,\"casualties\":7.6,\"targetStrength\":520.3,\"targetMorale\":63.2}",
   "minute 12: combat.morale {\"unitId\":\"red-1\",\"lossPercent\":6.4,\"roll\":5,\"needed\":1,\"passed\":false,\"morale\":7.6}",
   "minute 12: combat.fire {\"attacker\":\"blue-1\",\"target\":\"red-1\",\"distance\":151.3,\"cover\":1,\"aspect\":\"rear\",\"melee\":false,\"die\":5,\"casualties\":28,\"targetStrength\":528.6,\"targetMorale\":7.6}",
   "minute 12: combat.fire {\"attacker\":\"blue-2\",\"target\":\"red-1\",\"distance\":85.4,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":6,\"casualties\":8.3,\"targetStrength\":528.6,\"targetMorale\":7.6}",
   "minute 12: combat.fire {\"attacker\":\"red-1\",\"target\":\"blue-2\",\"distance\":85.4,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":3,\"casualties\":3.6,\"targetStrength\":516.7,\"targetMorale\":61.9}",
   "minute 12: unit.broken {\"unitId\":\"red-1\",\"morale\":7.6}",
   "minute 14: combat.morale {\"unitId\":\"red-1\",\"lossPercent\":26.4,\"roll\":7,\"needed\":0,\"passed\":false,\"morale\":0}",
   "minute 14: combat.fire {\"attacker\":\"blue-2\",\"target\":\"red-1\",\"distance\":185.3,\"cover\":1,\"aspect\":\"flank\",\"melee\":false,\"die\":1,\"casualties\":2.8,\"targetStrength\":388.8,\"targetMorale\":0}",
   "minute 14: combat.fire {\"attacker\":\"blue-3\",\"target\":\"red-1\",\"distance\":96.4,\"cover\":1,\"aspect\":\"flank\",\"melee\":true,\"die\":4,\"casualties\":137,\"targetStrength\":388.8,\"targetMorale\":0}",
   "minute 16: combat.morale {\"unitId\":\"red-1\",\"lossPercent\":52.9,\"roll\":4,\"needed\":0,\"passed\":false,\"morale\":0}",
   "minute 16: combat.fire {\"attacker\":\"blue-3\",\"target\":\"red-1\",\"distance\":98.4,\"cover\":1,\"aspect\":\"flank\",\"melee\":true,\"die\":6,\"casualties\":205.5,\"targetStrength\":183.3,\"targetMorale\":0}",
   "minute 18: combat.morale {\"unitId\":\"red-1\",\"lossPercent\":18.7,\"roll\":8,\"needed\":0,\"passed\":false,\"morale\":0}",
   "minute 18: combat.fire {\"attacker\":\"blue-3\",\"target\":\"red-1\",\"distance\":98.6,\"cover\":1,\"aspect\":\"flank\",\"melee\":true,\"die\":1,\"casualties\":34.3,\"targetStrength\":149.1,\"targetMorale\":0}"
  ]
 }
}
```

## Proposal A

```json
(no answer)
```

## Proposal B

```json
(no answer)
```

## Proposal C

```json
(no answer)
```

## Proposal D

```json
{
 "turn": 2,
 "units": [
  {
   "unitId": "blue-1",
   "x": 1900,
   "y": 1700,
   "facingDeg": 30,
   "formation": "line",
   "strength": 586,
   "morale": 78,
   "fatigue": 18,
   "ammo": 76,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Aubry had no new orders and held his line, angled on the bridge exit. As the enemy column came off the bridge and tried to deploy, he fired by volleys at about 170 m into its flank and kept it up until it broke and went back over the river."
  },
  {
   "unitId": "blue-2",
   "x": 2120,
   "y": 1640,
   "facingDeg": 300,
   "formation": "line",
   "strength": 527,
   "morale": 70,
   "fatigue": 18,
   "ammo": 78,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b2-11",
     "result": "carried-out"
    }
   ],
   "account": "Col. Delacroix moved, but in his own careful way, not 'at once'. He closed his column, sent skirmishers ahead and only reached the bridge exit around minute 7. There he formed line on the east side and closed the exit with fire at under 100 m. He took the column's return fire, and it gave way.",
   "departure": "The engine had the battalion at the bridge exit by minute 4. Its cautious colonel arrived about minute 7, so the crossfire began later. It ends in line, not column."
  },
  {
   "unitId": "blue-3",
   "x": 1900,
   "y": 1830,
   "facingDeg": 30,
   "formation": "line",
   "strength": 194,
   "morale": 88,
   "fatigue": 24,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b3-11",
     "result": "partly"
    }
   ],
   "account": "Maj. Verneuil took post behind the 1st Battalion as ordered, champing at the bit. When the enemy column broke at the bridge exit around minute 14, he could not bear to let it go. Without waiting for an order, he launched one charge into the fugitives jammed at the bridge mouth. Then he reined in at the river and brought his squadron back to its reserve post.",
   "departure": "The engine had the squadron pursue more than 1.2 km up the far road, to (2050,403). Its order was to stay in reserve and not engage. The bold major bent that order with one charge at the bridge mouth, then went back to his post behind the 1st Battalion."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1050,
   "facingDeg": 0,
   "formation": "column",
   "strength": 468,
   "morale": 12,
   "fatigue": 55,
   "ammo": 82,
   "status": "broken",
   "continuing": {
    "kind": "move",
    "x": 2050,
    "y": 700
   },
   "orders": [
    {
     "orderId": "r1-11",
     "result": "partly"
    }
   ],
   "account": "Col. Brandt pushed his column off the bridge the moment the order came and began to deploy on the south bank under fire from a line to his right. A second battalion came up on his left and closed the exit with fire at close range. Caught in a crossfire with his men still half-formed, the column broke around minute 13. A charge of horse at the bridge mouth sent it fleeing back over the river and up the road.",
   "departure": "The engine had the battalion cut down to 149 men and back at (2029,300). Crossfire and one charge at the bridge mouth plausibly cost about 180 men, and it ends broken around (2050,1050) after six minutes of flight, not 1.3 km away."
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 1250,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 66,
   "fatigue": 20,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Hartmann had no orders and held his line on the north bank. The fight at the bridge was beyond musket range. He watched the Vanguard break and come back past his flank."
  },
  {
   "unitId": "red-3",
   "x": 1550,
   "y": 400,
   "facingDeg": 180,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Maj. von Reiter had no orders and held his squadron far to the rear."
  }
 ],
 "observations": [
  {
   "side": "blue",
   "by": "blue-1",
   "unitId": "red-1",
   "when": "start"
  },
  {
   "side": "blue",
   "by": "blue-1",
   "unitId": "red-2",
   "when": "start"
  },
  {
   "side": "blue",
   "by": "blue-2",
   "unitId": "red-1",
   "when": "start"
  },
  {
   "side": "blue",
   "by": "blue-3",
   "unitId": "red-1",
   "when": "start"
  },
  {
   "side": "blue",
   "by": "blue-3",
   "unitId": "red-2",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-1",
   "unitId": "blue-1",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-1",
   "unitId": "blue-2",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-1",
   "unitId": "blue-3",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-2",
   "unitId": "blue-1",
   "when": "start"
  },
  {
   "side": "blue",
   "by": "blue-1",
   "unitId": "red-2",
   "when": "end"
  },
  {
   "side": "blue",
   "by": "blue-2",
   "unitId": "red-1",
   "when": "end"
  },
  {
   "side": "blue",
   "by": "blue-2",
   "unitId": "red-2",
   "when": "end"
  },
  {
   "side": "blue",
   "by": "blue-3",
   "unitId": "red-1",
   "when": "end"
  },
  {
   "side": "blue",
   "by": "blue-3",
   "unitId": "red-2",
   "when": "end"
  },
  {
   "side": "red",
   "by": "red-1",
   "unitId": "blue-2",
   "when": "end"
  },
  {
   "side": "red",
   "by": "red-2",
   "unitId": "blue-1",
   "when": "end"
  },
  {
   "side": "red",
   "by": "red-2",
   "unitId": "blue-2",
   "when": "end"
  }
 ],
 "summary": "Turn 2 (20-40). Red's Vanguard Battalion, already on the bridge, was ordered at minute 1 to push across and form on the south bank. Its head came off the bridge around minute 3 and began to deploy under volleys from Blue's 1st Battalion, angled on the exit about 170 m off. Blue's 2nd Battalion was ordered to close the exit at once, but its cautious colonel arrived only around minute 7. He formed line east of the exit and fired at under 100 m. Caught half-deployed in the crossfire, the Vanguard broke around minute 13. Blue's cavalry major had been told to stay in reserve behind the 1st and not engage without orders. He bent that order: one charge into the fugitives jammed at the bridge mouth, then he reined in at the river and returned to his post. The Vanguard lost about 180 men in all and ends broken around (2050,1050), streaming north. Blue lost 14 (1st), 23 (2nd) and 6 (cavalry). Red's Line Battalion held on the north bank, out of range. The engine's long pursuit to the Red rear was rejected."
}
```

## Proposal E

```json
{
 "turn": 2,
 "units": [
  {
   "unitId": "blue-1",
   "x": 1900,
   "y": 1700,
   "facingDeg": 55,
   "formation": "line",
   "strength": 595,
   "morale": 80,
   "fatigue": 14,
   "ammo": 78,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Aubry has no new order and stays in line on the south bank. When the enemy column crosses the bridge and forms on his flank at about 150 m, he wheels his line to face it and gives it volleys by battalion, steadily, until it breaks and goes back over the bridge. He does not follow it."
  },
  {
   "unitId": "blue-2",
   "x": 2120,
   "y": 1655,
   "facingDeg": 300,
   "formation": "line",
   "strength": 525,
   "morale": 69,
   "fatigue": 18,
   "ammo": 80,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b2-11",
     "result": "carried-out"
    }
   ],
   "account": "Col. Delacroix is told to advance at once to the south end of the bridge and close it. He does, but not at the double: he marches off in column, halts to deploy into line before he gets within reach of the bridge head, and by the time he is forward the enemy column is already over the bridge and forming on the south bank, 60 m from his flank. He deploys facing it and opens fire at close range, rather than charge. He closes the bridge once the column breaks and holds there.",
   "departure": "Projection brings the 2nd Battalion into line by minute 4, which assumes a hasty advance. A cautious colonel who stops to form before closing is a couple of minutes later, so fire begins later and his losses are smaller (525 against 517), his morale higher and his position about 25 m off."
  },
  {
   "unitId": "blue-3",
   "x": 1960,
   "y": 1790,
   "facingDeg": 0,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "fatigue": 3,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b3-11",
     "result": "carried-out"
    }
   ],
   "account": "Maj. Verneuil is told to hold in reserve behind the 1st Battalion and not to engage unless ordered. He moves up and forms close behind the 1st, as far forward as the order allows, and watches the enemy column come over the bridge and break. He is burning to charge, but his orders are plain: he stays in reserve and does not pursue.",
   "departure": "Projection sends the squadron into the fight and then in pursuit as far as (2050,403), killing most of the column (137+205+34 men). The order says not to engage unless ordered, and none comes, so he holds in reserve behind the 1st Battalion, and the column's survivors are not ridden down."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1050,
   "facingDeg": 0,
   "formation": "column",
   "strength": 400,
   "morale": 5,
   "fatigue": 50,
   "ammo": 70,
   "status": "broken",
   "continuing": {
    "kind": "move",
    "x": 2050,
    "y": 400
   },
   "orders": [
    {
     "orderId": "r1-11",
     "result": "carried-out"
    }
   ],
   "account": "Col. Brandt, already on the bridge when his order comes, pushes straight over it at the double and forms on the south bank as ordered, in the face of a battalion in line 150 m on his flank and another coming up. He presses the attack hard and holds his ground for a quarter of an hour under fire from both, losing heavily and unable to get his men to advance. At about the fourteenth minute they break and run, back over the bridge.",
   "departure": "Projection leaves the Vanguard with 149 men after the cavalry ride it down and sends it to (2029,300). With no pursuit, about 250 men are lost to volleys and the rout, 400 remain and it flees about 600 m north of the bridge. Strength and position both differ by more than the tolerance."
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 1250,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 66,
   "fatigue": 17,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Hartmann has no order and waits on the north bank, by the book. He watches the Vanguard cross the bridge and be beaten, and does not move without orders. His men are shaken by the sight."
  },
  {
   "unitId": "red-3",
   "x": 1550,
   "y": 400,
   "facingDeg": 180,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Maj. von Reiter has no order and holds his position."
  }
 ],
 "observations": [
  {
   "side": "blue",
   "by": "blue-1",
   "unitId": "red-1",
   "when": "start"
  },
  {
   "side": "blue",
   "by": "blue-1",
   "unitId": "red-2",
   "when": "start"
  },
  {
   "side": "blue",
   "by": "blue-2",
   "unitId": "red-1",
   "when": "start"
  },
  {
   "side": "blue",
   "by": "blue-3",
   "unitId": "red-1",
   "when": "start"
  },
  {
   "side": "blue",
   "by": "blue-3",
   "unitId": "red-2",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-1",
   "unitId": "blue-1",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-1",
   "unitId": "blue-2",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-1",
   "unitId": "blue-3",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-2",
   "unitId": "blue-1",
   "when": "start"
  },
  {
   "side": "blue",
   "by": "blue-1",
   "unitId": "red-2",
   "when": "end"
  },
  {
   "side": "blue",
   "by": "blue-2",
   "unitId": "red-2",
   "when": "end"
  },
  {
   "side": "blue",
   "by": "blue-3",
   "unitId": "red-1",
   "when": "end"
  },
  {
   "side": "blue",
   "by": "blue-3",
   "unitId": "red-2",
   "when": "end"
  },
  {
   "side": "red",
   "by": "red-2",
   "unitId": "blue-1",
   "when": "end"
  },
  {
   "side": "red",
   "by": "red-2",
   "unitId": "blue-2",
   "when": "end"
  }
 ],
 "summary": "Red-1, already on the bridge, pushed across and formed on the south bank, as ordered, with Blue-1 in line 150 m on its flank. Blue-1 fired on it with volleys, and Blue-2, advancing from its place behind the right, came up some minutes later than the projection supposed. A cautious colonel deployed before closing, then fired at under 100 m. From minute 6 or so the column took the fire of both battalions, losing about 250 men in all, and at about minute 14 it broke and fled back over the bridge. The cavalry, ordered to stay in reserve and not engage unless told, did not pursue, so the broken column escaped with about 400 men, about 600 m up the road. Blue-2 closed the bridge. Blue losses were about 5 men in the 1st Battalion and 25 in the 2nd. Red-2 held on the north bank and was shaken. Red-3 held."
}
```

## Proposal F

```json
{
 "turn": 2,
 "units": [
  {
   "unitId": "blue-1",
   "x": 1900,
   "y": 1700,
   "facingDeg": 82,
   "formation": "line",
   "strength": 600,
   "morale": 80,
   "fatigue": 21,
   "ammo": 75,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "The 1st Battalion acted as the staff tables direct."
  },
  {
   "unitId": "blue-2",
   "x": 2130,
   "y": 1650,
   "facingDeg": 334,
   "formation": "column",
   "strength": 517,
   "morale": 62,
   "fatigue": 20,
   "ammo": 65,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "b2-11",
     "result": "carried-out"
    }
   ],
   "account": "The 2nd Battalion acted as the staff tables direct."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 403,
   "facingDeg": 0,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "fatigue": 10,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "move",
    "x": 2050,
    "y": 300
   },
   "orders": [
    {
     "orderId": "b3-11",
     "result": "carried-out"
    }
   ],
   "account": "The Cavalry Squadron acted as the staff tables direct."
  },
  {
   "unitId": "red-1",
   "x": 2029,
   "y": 300,
   "facingDeg": 69,
   "formation": "column",
   "strength": 149,
   "morale": 0,
   "fatigue": 57,
   "ammo": 50,
   "status": "broken",
   "continuing": {
    "kind": "move",
    "x": 1950,
    "y": 300
   },
   "orders": [
    {
     "orderId": "r1-11",
     "result": "carried-out"
    }
   ],
   "account": "The Vanguard Battalion acted as the staff tables direct."
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 1250,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 70,
   "fatigue": 17,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "The Line Battalion acted as the staff tables direct."
  },
  {
   "unitId": "red-3",
   "x": 1550,
   "y": 400,
   "facingDeg": 180,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "The Hussar Squadron acted as the staff tables direct."
  }
 ],
 "observations": [],
 "summary": "The turn was resolved by the tables."
}
```
