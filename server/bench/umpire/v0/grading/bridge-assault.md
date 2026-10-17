# Case bridge-assault: A column assault on a defended bridge

**What this case tests.** Red-1 storms the bridge in column against two Blue battalions in line on the south bank, with Red-2 firing from the north bank. Napoleonic practice: a column crossing a 200 m bridge under the fire of two battalions should suffer heavily and most likely be thrown back unless Blue breaks; Blue takes losses from Red-2 fire. Losses should be in the tens to low hundreds, not whole battalions destroyed in 20 minutes.

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
   "x": 1980,
   "y": 1660,
   "facingDeg": 0,
   "formation": "line",
   "strength": 600,
   "morale": 80,
   "fatigue": 5,
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
   "x": 2120,
   "y": 1660,
   "facingDeg": 0,
   "formation": "line",
   "strength": 550,
   "morale": 75,
   "fatigue": 5,
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
   "y": 1850,
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
   "y": 1290,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 80,
   "fatigue": 25,
   "ammo": 100,
   "status": "active",
   "continuingFromLastTurn": {
    "kind": "hold"
   },
   "marchMetresPerTurnOpenGround": 2438,
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
   "y": 1300,
   "facingDeg": 200,
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
   "x": 1700,
   "y": 1200,
   "facingDeg": 180,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "fatigue": 20,
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
   "orderId": "r1-3",
   "side": "red",
   "to": "red-1",
   "text": "Storm the bridge at the double in column. Do not fire; use the bayonet. Take the far end and hold it.",
   "courier": "fast",
   "sentTurn": 2,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 2
  },
  {
   "orderId": "r2-3",
   "side": "red",
   "to": "red-2",
   "text": "Line the river bank and fire on the enemy battalions covering the bridge.",
   "courier": "fast",
   "sentTurn": 2,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 3
  },
  {
   "orderId": "b1-3",
   "side": "blue",
   "to": "blue-1",
   "text": "Hold the bridge at all costs. Fire by volleys on anything that sets foot on it.",
   "courier": "safe",
   "sentTurn": 2,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 1
  },
  {
   "orderId": "b2-3",
   "side": "blue",
   "to": "blue-2",
   "text": "Hold your line beside the 1st and give fire on the bridge.",
   "courier": "safe",
   "sentTurn": 2,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 1
  }
 ],
 "projection": {
  "units": [
   {
    "unitId": "blue-1",
    "x": 1980,
    "y": 1660,
    "facingDeg": 74,
    "formation": "line",
    "strength": 587,
    "morale": 75,
    "fatigue": 6,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    }
   },
   {
    "unitId": "blue-2",
    "x": 2120,
    "y": 1660,
    "facingDeg": 286,
    "formation": "line",
    "strength": 550,
    "morale": 75,
    "fatigue": 6,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    }
   },
   {
    "unitId": "blue-3",
    "x": 2000,
    "y": 348,
    "facingDeg": 314,
    "formation": "line",
    "strength": 200,
    "morale": 85,
    "fatigue": 10,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "move",
     "x": 2000,
     "y": 348
    }
   },
   {
    "unitId": "red-1",
    "x": 1950,
    "y": 300,
    "facingDeg": 254,
    "formation": "column",
    "strength": 96,
    "morale": 0,
    "fatigue": 46,
    "ammo": 70,
    "status": "broken",
    "continuing": {
     "kind": "idle"
    }
   },
   {
    "unitId": "red-2",
    "x": 2250,
    "y": 1360,
    "facingDeg": 200,
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
    "x": 1700,
    "y": 1200,
    "facingDeg": 180,
    "formation": "line",
    "strength": 220,
    "morale": 85,
    "fatigue": 12,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    }
   }
  ],
  "events": [
   "minute 1: unit.arrived {\"unitId\":\"blue-1\",\"at\":[1980,1660]}",
   "minute 1: unit.arrived {\"unitId\":\"blue-2\",\"at\":[2120,1660]}",
   "minute 4: unit.arrived {\"unitId\":\"red-2\",\"at\":[2250,1360]}",
   "minute 4: unit.arrived {\"unitId\":\"red-1\",\"at\":[2050,1640]}",
   "minute 6: combat.morale {\"unitId\":\"red-1\",\"lossPercent\":8,\"roll\":11,\"needed\":7,\"passed\":false,\"morale\":56}",
   "minute 6: combat.fire {\"attacker\":\"blue-1\",\"target\":\"red-1\",\"distance\":72.8,\"cover\":1,\"aspect\":\"flank\",\"melee\":false,\"die\":2,\"casualties\":14.1,\"targetStrength\":598.1,\"targetMorale\":56}",
   "minute 6: combat.fire {\"attacker\":\"blue-2\",\"target\":\"red-1\",\"distance\":72.8,\"cover\":1,\"aspect\":\"flank\",\"melee\":false,\"die\":6,\"casualties\":37.8,\"targetStrength\":598.1,\"targetMorale\":56}",
   "minute 6: combat.fire {\"attacker\":\"red-1\",\"target\":\"blue-1\",\"distance\":72.8,\"cover\":1,\"aspect\":\"flank\",\"melee\":false,\"die\":3,\"casualties\":6.6,\"targetStrength\":593.4,\"targetMorale\":77.3}",
   "minute 8: combat.morale {\"unitId\":\"red-1\",\"lossPercent\":11.6,\"roll\":3,\"needed\":3,\"passed\":true,\"morale\":25.8}",
   "minute 8: combat.fire {\"attacker\":\"blue-1\",\"target\":\"red-1\",\"distance\":72.8,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":6,\"casualties\":27.5,\"targetStrength\":528.6,\"targetMorale\":25.8}",
   "minute 8: combat.fire {\"attacker\":\"blue-2\",\"target\":\"red-1\",\"distance\":72.8,\"cover\":1,\"aspect\":\"rear\",\"melee\":false,\"die\":5,\"casualties\":42,\"targetStrength\":528.6,\"targetMorale\":25.8}",
   "minute 8: combat.fire {\"attacker\":\"red-1\",\"target\":\"blue-1\",\"distance\":72.8,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":2,\"casualties\":2.3,\"targetStrength\":591.1,\"targetMorale\":76.5}",
   "minute 10: combat.morale {\"unitId\":\"red-1\",\"lossPercent\":4.2,\"roll\":11,\"needed\":2,\"passed\":false,\"morale\":11.8}",
   "minute 10: combat.fire {\"attacker\":\"blue-1\",\"target\":\"red-1\",\"distance\":72.8,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":3,\"casualties\":13.7,\"targetStrength\":506.5,\"targetMorale\":11.8}",
   "minute 10: combat.fire {\"attacker\":\"blue-2\",\"target\":\"red-1\",\"distance\":72.8,\"cover\":1,\"aspect\":\"rear\",\"melee\":false,\"die\":1,\"casualties\":8.4,\"targetStrength\":506.5,\"targetMorale\":11.8}",
   "minute 10: combat.fire {\"attacker\":\"red-1\",\"target\":\"blue-1\",\"distance\":72.8,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":5,\"casualties\":4.1,\"targetStrength\":587,\"targetMorale\":75.1}",
   "minute 10: unit.broken {\"unitId\":\"red-1\",\"morale\":11.8}",
   "minute 12: combat.morale {\"unitId\":\"red-1\",\"lossPercent\":40.6,\"roll\":6,\"needed\":0,\"passed\":false,\"morale\":0}",
   "minute 12: combat.fire {\"attacker\":\"blue-3\",\"target\":\"red-1\",\"distance\":89.3,\"cover\":1,\"aspect\":\"flank\",\"melee\":true,\"die\":6,\"casualties\":205.5,\"targetStrength\":301,\"targetMorale\":0}",
   "minute 16: unit.rallyFailed {\"unitId\":\"red-1\",\"reason\":\"pressed\"}",
   "minute 17: unit.arrived {\"unitId\":\"red-1\",\"at\":[1950,300]}",
   "minute 18: unit.rallyFailed {\"unitId\":\"red-1\",\"reason\":\"pressed\"}",
   "minute 18: combat.morale {\"unitId\":\"red-1\",\"lossPercent\":22.8,\"roll\":5,\"needed\":0,\"passed\":false,\"morale\":0}",
   "minute 18: combat.fire {\"attacker\":\"blue-3\",\"target\":\"red-1\",\"distance\":69.2,\"cover\":1,\"aspect\":\"flank\",\"melee\":true,\"die\":2,\"casualties\":68.5,\"targetStrength\":232.5,\"targetMorale\":0}",
   "minute 20: unit.rallyFailed {\"unitId\":\"red-1\",\"reason\":\"pressed\"}",
   "minute 20: combat.morale {\"unitId\":\"red-1\",\"lossPercent\":58.9,\"roll\":9,\"needed\":0,\"passed\":false,\"morale\":0}",
   "minute 20: combat.fire {\"attacker\":\"blue-3\",\"target\":\"red-1\",\"distance\":69.2,\"cover\":1,\"aspect\":\"flank\",\"melee\":true,\"die\":4,\"casualties\":137,\"targetStrength\":95.5,\"targetMorale\":0}"
  ]
 }
}
```

## Proposal A

```json
{
 "turn": 2,
 "units": [
  {
   "unitId": "blue-1",
   "x": 1980,
   "y": 1660,
   "facingDeg": 74,
   "formation": "line",
   "strength": 587,
   "morale": 75,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b1-3",
     "result": "carried-out"
    }
   ],
   "account": "Col. Aubry held the bridge as ordered, firing volleys at the enemy column. The bridge is still intact, but the enemy's morale is dropping."
  },
  {
   "unitId": "blue-2",
   "x": 2120,
   "y": 1660,
   "facingDeg": 286,
   "formation": "line",
   "strength": 550,
   "morale": 75,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b2-3",
     "result": "carried-out"
    }
   ],
   "account": "Col. Delacroix held his position, providing covering fire for the 1st Battalion. The enemy's morale is low, but they are still a threat."
  },
  {
   "unitId": "blue-3",
   "x": 2000,
   "y": 348,
   "facingDeg": 314,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "status": "active",
   "continuing": {
    "kind": "move",
    "x": 2000,
    "y": 348
   },
   "orders": [
    {
     "orderId": "b1-3",
     "result": "partly"
    }
   ],
   "account": "Maj. Verneuil moved to support the bridge but was delayed by the enemy's fire. He is now in position to charge if needed."
  },
  {
   "unitId": "red-1",
   "x": 1950,
   "y": 300,
   "facingDeg": 254,
   "formation": "column",
   "strength": 96,
   "morale": 0,
   "status": "broken",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "r1-3",
     "result": "misread"
    }
   ],
   "account": "Col. Brandt's column was misread as a flanking attack. He broke and fled, taking heavy losses."
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 1360,
   "facingDeg": 200,
   "formation": "line",
   "strength": 650,
   "morale": 70,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r2-3",
     "result": "partly"
    }
   ],
   "account": "Col. Hartmann held his line, firing on the bridge defenders. The enemy's morale is low, but they are still a threat."
  },
  {
   "unitId": "red-3",
   "x": 1700,
   "y": 1200,
   "facingDeg": 180,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r2-3",
     "result": "not-arrived"
    }
   ],
   "account": "Maj. von Reiter's squadron was delayed and did not arrive in time to support the attack."
  }
 ],
 "observations": [
  {
   "side": "blue",
   "unitId": "blue-1",
   "by": "blue-1",
   "when": "end"
  },
  {
   "side": "blue",
   "unitId": "blue-2",
   "by": "blue-2",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "red-2",
   "by": "red-2",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "red-1",
   "by": "red-1",
   "when": "end"
  }
 ],
 "summary": "In this turn, the Blue side held the bridge successfully, inflicting heavy casualties on the Red side. The Red Vanguard Battalion broke and fled, while the Line Battalion held its position but suffered significant morale loss. The Red Hussar Squadron was delayed and did not arrive in time to support the attack. The Blue Cavalry Squadron, though not fully committed, was in position to charge if needed."
}
```

## Proposal B

```json
{
 "turn": 2,
 "units": [
  {
   "unitId": "blue-1",
   "x": 1980,
   "y": 1660,
   "facingDeg": 74,
   "formation": "line",
   "strength": 587,
   "morale": 75,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b1-3",
     "result": "carried-out"
    }
   ],
   "account": "Col. Aubry held the line as ordered, firing volleys at the enemy.",
   "departure": ""
  },
  {
   "unitId": "blue-2",
   "x": 2120,
   "y": 1660,
   "facingDeg": 286,
   "formation": "line",
   "strength": 550,
   "morale": 75,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b2-3",
     "result": "carried-out"
    }
   ],
   "account": "Col. Delacroix held his line beside the 1st Battalion, firing on the bridge.",
   "departure": ""
  },
  {
   "unitId": "blue-3",
   "x": 2000,
   "y": 348,
   "facingDeg": 314,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "status": "active",
   "continuing": {
    "kind": "move",
    "x": 2000,
    "y": 348
   },
   "orders": [],
   "account": "Maj. Verneuil moved his cavalry squadron to support the infantry.",
   "departure": ""
  },
  {
   "unitId": "red-1",
   "x": 1950,
   "y": 300,
   "facingDeg": 254,
   "formation": "column",
   "strength": 96,
   "morale": 0,
   "status": "broken",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "r1-3",
     "result": "carried-out"
    }
   ],
   "account": "Col. Brandt's battalion was broken, unable to hold the bridge.",
   "departure": "The unit's morale was too low to hold the bridge."
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 1360,
   "facingDeg": 200,
   "formation": "line",
   "strength": 650,
   "morale": 70,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r2-3",
     "result": "carried-out"
    }
   ],
   "account": "Col. Hartmann held his line along the river bank, firing on the enemy.",
   "departure": ""
  },
  {
   "unitId": "red-3",
   "x": 1700,
   "y": 1200,
   "facingDeg": 180,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Maj. von Reiter held his position, waiting for orders.",
   "departure": ""
  }
 ],
 "observations": [
  {
   "side": "blue",
   "unitId": "blue-1",
   "by": "blue-1",
   "when": "end"
  },
  {
   "side": "blue",
   "unitId": "blue-2",
   "by": "blue-2",
   "when": "end"
  },
  {
   "side": "blue",
   "unitId": "blue-3",
   "by": "blue-3",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "red-1",
   "by": "red-2",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "red-2",
   "by": "red-2",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "red-3",
   "by": "red-3",
   "when": "end"
  }
 ],
 "summary": "The battle continued with the Blue forces holding the bridge and the Red forces trying to break through. The Red 1st Battalion was broken and unable to hold the bridge, while the Red 2nd Battalion held its position along the river bank. The Red 3rd Battalion held its position, waiting for orders."
}
```

## Proposal C

```json
{
 "turn": 2,
 "units": [
  {
   "unitId": "blue-1",
   "x": 1980,
   "y": 1660,
   "facingDeg": 180,
   "formation": "line",
   "strength": 580,
   "morale": 75,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b1-3",
     "result": "carried-out"
    }
   ],
   "account": "Col. Aubry, being literal, maintained his position and fired volleys as ordered, holding the line firmly against the advancing enemy. The pressure was intense, but the discipline held.",
   "departure": "Sustained heavy casualties from the enemy advance."
  },
  {
   "unitId": "blue-2",
   "x": 2120,
   "y": 1660,
   "facingDeg": 180,
   "formation": "line",
   "strength": 550,
   "morale": 75,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b2-3",
     "result": "carried-out"
    }
   ],
   "account": "Col. Delacroix, cautious, held his line beside the 1st Battalion, providing supporting fire on the bridge as instructed. He maintained his defensive posture, unwilling to commit reserves prematurely.",
   "departure": "Engaged in heavy fire exchange with the enemy line."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1550,
   "facingDeg": 180,
   "formation": "line",
   "strength": 180,
   "morale": 85,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Maj. Verneuil, driven by aggressive initiative, ordered his cavalry to charge down towards the main line of battle, aiming to disrupt the enemy's advance and exploit the chaos at the bridge.",
   "departure": "The charge was costly, but it successfully engaged the enemy's forward elements."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1500,
   "facingDeg": 0,
   "formation": "column",
   "strength": 50,
   "morale": 0,
   "status": "broken",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "r1-3",
     "result": "carried-out"
    }
   ],
   "account": "Despite the order to storm the bridge, the unit was already broken and morale was nonexistent. The attempt to charge was a desperate, disorganized rush into the line of fire, resulting in massive losses and immediate rout.",
   "departure": "The unit failed to take the bridge and was routed immediately upon contact."
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 1500,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 70,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r2-3",
     "result": "carried-out"
    }
   ],
   "account": "Col. Hartmann, adhering strictly to orders, moved his battalion to the river bank and began firing on the enemy battalions covering the bridge, establishing a strong defensive line.",
   "departure": "Engaged in sustained fire with Blue-1 and Blue-2."
  },
  {
   "unitId": "red-3",
   "x": 1700,
   "y": 1200,
   "facingDeg": 180,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Maj. von Reiter maintained his position, recognizing the main thrust was focused on the bridge. He held his line, ready to exploit any weakness in the enemy's flank.",
   "departure": "Maintained position, observing the main engagement."
  }
 ],
 "observations": [
  {
   "side": "blue",
   "unitId": "blue-1",
   "by": "blue-1",
   "when": "end"
  },
  {
   "side": "blue",
   "unitId": "blue-2",
   "by": "blue-2",
   "when": "end"
  },
  {
   "side": "blue",
   "unitId": "blue-3",
   "by": "blue-3",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "red-2",
   "by": "red-3",
   "when": "end"
  }
 ],
 "summary": "The battle intensified around the bridge. Red-1, despite the aggressive order, was already broken and suffered catastrophic losses attempting a desperate charge across the bridge, failing to take the objective. Red-2 successfully positioned itself along the river bank, establishing a strong firing line against the blue infantry. Blue-1 and Blue-2 held their positions, executing their defensive orders and repelling the initial assault. Blue-3, capitalizing on the initiative, charged down to support the infantry defense, engaging the enemy's forward elements. The blue defense held firm, though casualties were heavy, while the red attack faltered due to the state of Red-1.",
 "rolls": []
}
```

## Proposal D

```json
{
 "turn": 2,
 "units": [
  {
   "unitId": "blue-1",
   "x": 1980,
   "y": 1660,
   "facingDeg": 30,
   "formation": "line",
   "strength": 591,
   "morale": 79,
   "fatigue": 12,
   "ammo": 82,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b1-3",
     "result": "carried-out"
    }
   ],
   "account": "Col. Aubry did exactly as ordered. He wheeled his right companies towards the bridge and gave rolling volleys into the column as soon as its head set foot on the span. Some of the leading enemy reached his front with the bayonet and were thrown back. He held his ground throughout."
  },
  {
   "unitId": "blue-2",
   "x": 2120,
   "y": 1660,
   "facingDeg": 330,
   "formation": "line",
   "strength": 545,
   "morale": 76,
   "fatigue": 12,
   "ammo": 84,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b2-3",
     "result": "carried-out"
    }
   ],
   "account": "Col. Delacroix held his line beside the 1st and turned his left wing on the bridge, firing into the flank of the column as it crowded the far end of the span. He did not advance a step beyond his line."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1800,
   "facingDeg": 0,
   "formation": "line",
   "strength": 186,
   "morale": 84,
   "fatigue": 22,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Maj. Verneuil had no orders, but he saw the enemy column stall in disorder at the bridge exit under the crossfire and charged its head on his own initiative. He drove it back onto the span. Then he reined in at the bridge rather than cross under the guns of the far bank, and re-formed behind the infantry.",
   "departure": "The engine had the squadron cross the bridge and chase the broken battalion more than a kilometre to (2000,348). It charged the column's head at the bridge exit, stopped at the river and re-formed behind its own line."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1050,
   "facingDeg": 0,
   "formation": "column",
   "strength": 468,
   "morale": 14,
   "fatigue": 55,
   "ammo": 96,
   "status": "broken",
   "continuing": {
    "kind": "move",
    "x": 2050,
    "y": 700
   },
   "orders": [
    {
     "orderId": "r1-3",
     "result": "partly"
    }
   ],
   "account": "Col. Brandt flung his column at the bridge at the double with bayonets fixed, forbidding any firing. The head crossed the span under a crossfire from two lines. A few companies reached the south bank, but there the column stalled, and a charge of horse threw it back onto the bridge. The battalion broke and streamed back across the river and up the road, Brandt trying in vain to stop it.",
   "departure": "The engine had the battalion broken and butchered down to 96 men, back at (1950,300) by minute 17. Crossfire and one charge at the bridge plausibly cost about 180 men. The fugitives are about 600 m up the road by turn's end, not 1.3 km away, and not cut down in a 1 km cavalry pursuit."
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 1390,
   "facingDeg": 205,
   "formation": "line",
   "strength": 650,
   "morale": 66,
   "fatigue": 28,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r2-3",
     "result": "partly"
    }
   ],
   "account": "Col. Hartmann advanced his line to the edge of the north bank as ordered. The enemy battalions stood about 300 m beyond the river, too far for musketry, so he held his fire rather than waste powder. He watched the Vanguard's assault fail on the bridge."
  },
  {
   "unitId": "red-3",
   "x": 1700,
   "y": 1200,
   "facingDeg": 180,
   "formation": "line",
   "strength": 220,
   "morale": 82,
   "fatigue": 15,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Maj. von Reiter had no orders. He held his hussars west of the road and watched the assault fail. The river stopped him intervening."
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
   "by": "blue-1",
   "unitId": "red-3",
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
   "by": "blue-2",
   "unitId": "red-2",
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
   "side": "blue",
   "by": "blue-3",
   "unitId": "red-3",
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
   "side": "red",
   "by": "red-2",
   "unitId": "blue-2",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-2",
   "unitId": "blue-3",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-3",
   "unitId": "blue-1",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-3",
   "unitId": "blue-2",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-3",
   "unitId": "blue-3",
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
   "by": "blue-1",
   "unitId": "red-3",
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
   "side": "blue",
   "by": "blue-3",
   "unitId": "red-3",
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
  },
  {
   "side": "red",
   "by": "red-2",
   "unitId": "blue-3",
   "when": "end"
  },
  {
   "side": "red",
   "by": "red-3",
   "unitId": "blue-1",
   "when": "end"
  },
  {
   "side": "red",
   "by": "red-3",
   "unitId": "blue-2",
   "when": "end"
  },
  {
   "side": "red",
   "by": "red-3",
   "unitId": "blue-3",
   "when": "end"
  }
 ],
 "summary": "Turn 2 (20-40). Red's Vanguard Battalion stormed the bridge at the double in column, bayonets fixed and not firing. Blue's 1st and 2nd Battalions, in line about 80 m either side of the bridge's south exit, caught the column in a crossfire of volleys from minute 5. The head reached the south bank in disorder and some companies came to the bayonet against the 1st Battalion's right. Around minute 10, Blue's cavalry squadron charged on its own initiative and drove the stalled head back onto the span, and the battalion broke. It fled back over the bridge and up the high road. It lost about 180 men and ends broken around (2050,1050). The squadron stopped at the river and re-formed behind the Blue line, losing 14 men. Red's Line Battalion lined the north bank as ordered, but the Blue lines were about 300 m off, beyond musket range, so it held its fire. Red's hussars, without orders, stayed west of the road. Blue's infantry lost only a handful of men and spent part of its ammunition. Blue still holds the bridge and its south end. The engine's projection had the broken Vanguard chased 1.3 km and cut down to 96 men; that was rejected as implausible."
}
```

## Proposal E

```json
{
 "turn": 2,
 "units": [
  {
   "unitId": "blue-1",
   "x": 1980,
   "y": 1660,
   "facingDeg": 20,
   "formation": "line",
   "strength": 585,
   "morale": 77,
   "fatigue": 8,
   "ammo": 85,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b1-3",
     "result": "carried-out"
    }
   ],
   "account": "Col. Aubry holds the bridge as ordered. He lets the enemy column step onto it, then gives it volleys by battalion at under 200 m as it comes on, and keeps his line steady when the head of the column reaches the south end on his flank and the bayonets meet. The column is thrown back and he does not pursue over the bridge, as his order is to hold it, not to cross."
  },
  {
   "unitId": "blue-2",
   "x": 2120,
   "y": 1660,
   "facingDeg": 340,
   "formation": "line",
   "strength": 538,
   "morale": 75,
   "fatigue": 8,
   "ammo": 85,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b2-3",
     "result": "carried-out"
    }
   ],
   "account": "Col. Delacroix holds his line beside the 1st Battalion and gives fire on the bridge as ordered, pouring volleys into the flank of the column as it crosses. Cautious, he keeps his men in the line and does not follow the broken enemy."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1620,
   "facingDeg": 0,
   "formation": "line",
   "strength": 197,
   "morale": 88,
   "fatigue": 8,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Maj. Verneuil has no new order, but seeing the head of the enemy column stagger and break against the infantry on either side of the road he cannot sit still. He takes his squadron up between the two battalions, sabres the remnants at the south end of the bridge, and drives them back over it. He halts at the south end when he sees the enemy's second line on the far bank, and re-forms in the gap between the battalions.",
   "departure": "Projection sends the cavalry in pursuit over the bridge and up the road to (2000,348), killing most of the column (205+68+137 men). Verneuil is aggressive but sees a fresh enemy battalion lined on the far bank and enemy horse on the flank; he charges only to the bridge's south end, so he ends 1.2 km short of the projected position and the column loses far fewer men."
  },
  {
   "unitId": "red-1",
   "x": 2030,
   "y": 1050,
   "facingDeg": 0,
   "formation": "column",
   "strength": 300,
   "morale": 8,
   "fatigue": 45,
   "ammo": 100,
   "status": "broken",
   "continuing": {
    "kind": "move",
    "x": 2050,
    "y": 500
   },
   "orders": [
    {
     "orderId": "r1-3",
     "result": "partly"
    }
   ],
   "account": "Col. Brandt takes his column at the double down the road and onto the bridge, with the bayonet and without halting to fire. Volleys from both battalions at close range cut it down on the bridge, and the head, reaching the far end, is caught by fire on both flanks and cannot take the position. The men turn about, the column breaks, and the survivors are driven back over the bridge by horse, the colonel with them.",
   "departure": "The projection kills 554 men and ends with the battalion at (1950,300). Here the column crosses the bridge as ordered and takes about 250 casualties from volleys during the crossing and at the far end, then another 100 from the sabres of the cavalry on the bridge, so it ends at 300 men (a difference of over 5% of its strength) and flees about 250 m in the time left rather than the projected 1 km."
  },
  {
   "unitId": "red-2",
   "x": 2200,
   "y": 1390,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 60,
   "fatigue": 22,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r2-3",
     "result": "partly"
    }
   ],
   "account": "Col. Hartmann moves his battalion down to the north bank and forms line on it as ordered. The enemy battalions are over 250 m off, beyond musket range across the river, so he does not waste his ammunition. He watches the Vanguard's column be repulsed at the bridge and holds the bank, shaken, awaiting orders.",
   "departure": "Projection leaves red-2 at (2250,1360), with morale 70. It forms on the bank at (2200,1390), which is within the tolerance, but the repulse of the column in front of it shakes it, so morale ends at 60."
  },
  {
   "unitId": "red-3",
   "x": 1700,
   "y": 1200,
   "facingDeg": 180,
   "formation": "line",
   "strength": 220,
   "morale": 80,
   "fatigue": 12,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Maj. von Reiter has no order and holds where he stands, watching the attack on the bridge fail. His men are uneasy after what they have seen."
  }
 ],
 "observations": [
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
   "side": "red",
   "by": "red-2",
   "unitId": "blue-2",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-2",
   "unitId": "blue-3",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-3",
   "unitId": "blue-1",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-3",
   "unitId": "blue-2",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-3",
   "unitId": "blue-3",
   "when": "start"
  },
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
   "by": "blue-1",
   "unitId": "red-3",
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
   "by": "blue-2",
   "unitId": "red-2",
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
   "side": "blue",
   "by": "blue-3",
   "unitId": "red-3",
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
   "by": "blue-1",
   "unitId": "red-3",
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
   "side": "blue",
   "by": "blue-3",
   "unitId": "red-3",
   "when": "end"
  },
  {
   "side": "red",
   "by": "red-1",
   "unitId": "blue-3",
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
  },
  {
   "side": "red",
   "by": "red-2",
   "unitId": "blue-3",
   "when": "end"
  },
  {
   "side": "red",
   "by": "red-3",
   "unitId": "blue-1",
   "when": "end"
  },
  {
   "side": "red",
   "by": "red-3",
   "unitId": "blue-2",
   "when": "end"
  },
  {
   "side": "red",
   "by": "red-3",
   "unitId": "blue-3",
   "when": "end"
  }
 ],
 "summary": "Red-1 stormed the bridge at the double in column, with the bayonet and without firing. Blue-1 and Blue-2, in line 70 m to either side of the south end, fired volleys into it from about the middle of the bridge onward and again at the far end. The column lost about 250 men on the crossing and at the south end, lost heart and broke, and the cavalry (Blue-3, acting without orders) cut down another hundred or so of the fugitives on the bridge and drove them back over it, ending at the south end. Red-1 ends at 300 men, broken, 250 m back on the north road. Red-2 lined the north bank but the Blue battalions were out of musket range across the river, so there was no fire. It lost some morale from the repulse. Red-3 held. Blue losses were light: about 15 men in each battalion and 3 in the cavalry. The bridge remains in Blue hands. The projection was too severe on Red-1 (554 killed) and has the cavalry riding up to the far end of the map; the umpire limited the pursuit to the bridge."
}
```

## Proposal F

```json
{
 "turn": 2,
 "units": [
  {
   "unitId": "blue-1",
   "x": 1980,
   "y": 1660,
   "facingDeg": 74,
   "formation": "line",
   "strength": 587,
   "morale": 75,
   "fatigue": 6,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b1-3",
     "result": "carried-out"
    }
   ],
   "account": "The 1st Battalion acted as the staff tables direct."
  },
  {
   "unitId": "blue-2",
   "x": 2120,
   "y": 1660,
   "facingDeg": 286,
   "formation": "line",
   "strength": 550,
   "morale": 75,
   "fatigue": 6,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b2-3",
     "result": "carried-out"
    }
   ],
   "account": "The 2nd Battalion acted as the staff tables direct."
  },
  {
   "unitId": "blue-3",
   "x": 2000,
   "y": 348,
   "facingDeg": 314,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "fatigue": 10,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "move",
    "x": 2000,
    "y": 348
   },
   "orders": [],
   "account": "The Cavalry Squadron acted as the staff tables direct."
  },
  {
   "unitId": "red-1",
   "x": 1950,
   "y": 300,
   "facingDeg": 254,
   "formation": "column",
   "strength": 96,
   "morale": 0,
   "fatigue": 46,
   "ammo": 70,
   "status": "broken",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "r1-3",
     "result": "carried-out"
    }
   ],
   "account": "The Vanguard Battalion acted as the staff tables direct."
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 1360,
   "facingDeg": 200,
   "formation": "line",
   "strength": 650,
   "morale": 70,
   "fatigue": 17,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r2-3",
     "result": "carried-out"
    }
   ],
   "account": "The Line Battalion acted as the staff tables direct."
  },
  {
   "unitId": "red-3",
   "x": 1700,
   "y": 1200,
   "facingDeg": 180,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "fatigue": 12,
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
