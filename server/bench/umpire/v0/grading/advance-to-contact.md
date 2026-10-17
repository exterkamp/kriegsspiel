# Case advance-to-contact: An advance to contact with a cavalry picket north of the bridge

**What this case tests.** Red infantry and hussars advance on a Blue cavalry picket posted north of the bridge, whose order is to fall back over the bridge if pressed. A good umpire has the picket see the column, skirmish briefly and retire, with small losses on both sides at most; the picket ends south of the river or on the bridge.

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
   "x": 1960,
   "y": 1680,
   "facingDeg": 0,
   "formation": "line",
   "strength": 600,
   "morale": 80,
   "fatigue": 0,
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
   "x": 2140,
   "y": 1680,
   "facingDeg": 0,
   "formation": "line",
   "strength": 550,
   "morale": 75,
   "fatigue": 0,
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
   "y": 1250,
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
   "y": 850,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 80,
   "fatigue": 15,
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
   "id": "red-2",
   "side": "red",
   "name": "Line Battalion",
   "type": "line_infantry",
   "kind": "infantry",
   "commander": "Col. Hartmann",
   "personality": [],
   "character": "by the book; waits for orders",
   "x": 2050,
   "y": 550,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 70,
   "fatigue": 15,
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
   "id": "red-3",
   "side": "red",
   "name": "Hussar Squadron",
   "type": "cavalry",
   "kind": "cavalry",
   "commander": "Maj. von Reiter",
   "personality": [],
   "character": "dashing scout; prone to over-reach",
   "x": 1800,
   "y": 900,
   "facingDeg": 160,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "fatigue": 10,
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
   "orderId": "r1-2",
   "side": "red",
   "to": "red-1",
   "text": "Advance to the bridge. Drive off any pickets on this bank.",
   "courier": "fast",
   "sentTurn": 2,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 4
  },
  {
   "orderId": "r3-2",
   "side": "red",
   "to": "red-3",
   "text": "Ride on the Vanguard's right and cut off the enemy horse if it tries to stand.",
   "courier": "fast",
   "sentTurn": 2,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 3
  },
  {
   "orderId": "b3-1",
   "side": "blue",
   "to": "blue-3",
   "text": "Hold the north end of the bridge as a picket. Watch the road. If pressed by infantry, fall back over the bridge and re-form behind the 1st Battalion.",
   "courier": "safe",
   "sentTurn": 1,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 0
  }
 ],
 "projection": {
  "units": [
   {
    "unitId": "blue-1",
    "x": 1960,
    "y": 1680,
    "facingDeg": 0,
    "formation": "line",
    "strength": 600,
    "morale": 80,
    "fatigue": 0,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    }
   },
   {
    "unitId": "blue-2",
    "x": 2140,
    "y": 1680,
    "facingDeg": 0,
    "formation": "line",
    "strength": 550,
    "morale": 75,
    "fatigue": 0,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    }
   },
   {
    "unitId": "blue-3",
    "x": 2050,
    "y": 1250,
    "facingDeg": 180,
    "formation": "line",
    "strength": 162,
    "morale": 29,
    "fatigue": 21,
    "ammo": 65,
    "status": "active",
    "continuing": {
     "kind": "hold"
    }
   },
   {
    "unitId": "red-1",
    "x": 2050,
    "y": 1350,
    "facingDeg": 0,
    "formation": "column",
    "strength": 627,
    "morale": 72,
    "fatigue": 37,
    "ammo": 30,
    "status": "active",
    "continuing": {
     "kind": "idle"
    }
   },
   {
    "unitId": "red-2",
    "x": 2050,
    "y": 550,
    "facingDeg": 180,
    "formation": "column",
    "strength": 650,
    "morale": 70,
    "fatigue": 7,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    }
   },
   {
    "unitId": "red-3",
    "x": 1950,
    "y": 1300,
    "facingDeg": 160,
    "formation": "line",
    "strength": 220,
    "morale": 85,
    "fatigue": 2,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "idle"
    }
   }
  ],
  "events": [
   "minute 0: unit.arrived {\"unitId\":\"blue-3\",\"at\":[2050,1250]}",
   "minute 4: unit.arrived {\"unitId\":\"red-3\",\"at\":[1950,1300]}",
   "minute 6: unit.arrived {\"unitId\":\"red-1\",\"at\":[2050,1350]}",
   "minute 7: combat.morale {\"unitId\":\"blue-3\",\"lossPercent\":7.5,\"roll\":8,\"needed\":7,\"passed\":false,\"morale\":58.4}",
   "minute 7: combat.fire {\"attacker\":\"blue-3\",\"target\":\"red-1\",\"distance\":100,\"cover\":1,\"aspect\":\"rear\",\"melee\":false,\"die\":2,\"casualties\":4.4,\"targetStrength\":645.6,\"targetMorale\":78}",
   "minute 7: combat.fire {\"attacker\":\"red-1\",\"target\":\"blue-3\",\"distance\":100,\"cover\":1,\"aspect\":\"rear\",\"melee\":false,\"die\":6,\"casualties\":15,\"targetStrength\":185,\"targetMorale\":58.4}",
   "minute 9: combat.fire {\"attacker\":\"blue-3\",\"target\":\"red-1\",\"distance\":100,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":6,\"casualties\":5.3,\"targetStrength\":640.3,\"targetMorale\":76.3}",
   "minute 9: combat.fire {\"attacker\":\"red-1\",\"target\":\"blue-3\",\"distance\":100,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":6,\"casualties\":7.4,\"targetStrength\":177.6,\"targetMorale\":50.5}",
   "minute 11: combat.fire {\"attacker\":\"blue-3\",\"target\":\"red-1\",\"distance\":100,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":5,\"casualties\":4,\"targetStrength\":636.3,\"targetMorale\":75.1}",
   "minute 11: combat.fire {\"attacker\":\"red-1\",\"target\":\"blue-3\",\"distance\":100,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":2,\"casualties\":2.4,\"targetStrength\":175.2,\"targetMorale\":47.7}",
   "minute 13: combat.fire {\"attacker\":\"blue-3\",\"target\":\"red-1\",\"distance\":100,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":2,\"casualties\":1.6,\"targetStrength\":634.7,\"targetMorale\":74.6}",
   "minute 13: combat.fire {\"attacker\":\"red-1\",\"target\":\"blue-3\",\"distance\":100,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":1,\"casualties\":1.2,\"targetStrength\":174,\"targetMorale\":46.4}",
   "minute 15: combat.fire {\"attacker\":\"blue-3\",\"target\":\"red-1\",\"distance\":100,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":3,\"casualties\":2.3,\"targetStrength\":632.4,\"targetMorale\":73.9}",
   "minute 15: combat.fire {\"attacker\":\"red-1\",\"target\":\"blue-3\",\"distance\":100,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":1,\"casualties\":1.2,\"targetStrength\":172.8,\"targetMorale\":45}",
   "minute 17: combat.morale {\"unitId\":\"blue-3\",\"lossPercent\":4.1,\"roll\":11,\"needed\":4,\"passed\":false,\"morale\":32.8}",
   "minute 17: combat.fire {\"attacker\":\"blue-3\",\"target\":\"red-1\",\"distance\":100,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":5,\"casualties\":3.8,\"targetStrength\":628.7,\"targetMorale\":72.7}",
   "minute 17: combat.fire {\"attacker\":\"red-1\",\"target\":\"blue-3\",\"distance\":100,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":6,\"casualties\":7.1,\"targetStrength\":165.7,\"targetMorale\":32.8}",
   "minute 19: combat.fire {\"attacker\":\"blue-3\",\"target\":\"red-1\",\"distance\":100,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":3,\"casualties\":2,\"targetStrength\":626.7,\"targetMorale\":72}",
   "minute 19: combat.fire {\"attacker\":\"red-1\",\"target\":\"blue-3\",\"distance\":100,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":3,\"casualties\":3.5,\"targetStrength\":162.2,\"targetMorale\":28.6}"
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
   "x": 1960,
   "y": 1680,
   "facingDeg": 0,
   "formation": "line",
   "strength": 600,
   "morale": 80,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b3-1",
     "result": "carried-out"
    }
   ],
   "account": "Col. Aubry holds his position, maintaining the line and watching the road. He is cautious about committing his reserves."
  },
  {
   "unitId": "blue-2",
   "x": 2140,
   "y": 1680,
   "facingDeg": 0,
   "formation": "line",
   "strength": 550,
   "morale": 75,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b3-1",
     "result": "partly"
    }
   ],
   "account": "Col. Delacroix is hesitant to move his battalion, preferring to wait for further orders."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1250,
   "facingDeg": 180,
   "formation": "line",
   "strength": 162,
   "morale": 29,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "b3-1",
     "result": "misread"
    }
   ],
   "account": "Maj. Verneuil, eager to act, misinterprets the order and moves his squadron to the bridge, where he is engaged in combat."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1350,
   "facingDeg": 0,
   "formation": "column",
   "strength": 627,
   "morale": 72,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "r1-2",
     "result": "carried-out"
    }
   ],
   "account": "Col. Brandt advances his battalion towards the bridge, engaging the blue picket."
  },
  {
   "unitId": "red-2",
   "x": 2050,
   "y": 550,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 70,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r1-2",
     "result": "not-arrived"
    }
   ],
   "account": "Col. Hartmann waits for further orders, maintaining his position."
  },
  {
   "unitId": "red-3",
   "x": 1950,
   "y": 1300,
   "facingDeg": 160,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "r3-2",
     "result": "partly"
    }
   ],
   "account": "Maj. von Reiter rides to the left of the Vanguard, but does not engage the enemy as planned."
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
   "by": "red-1",
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
 "summary": "In turn 2, the red vanguard battalion advances towards the bridge, engaging the blue picket. The blue cavalry squadron, misinterpreting its orders, moves to the bridge and is engaged in combat. The red line battalion waits for further orders, while the red hussar squadron rides to the left of the vanguard but does not engage the enemy. The blue line battalions hold their positions, maintaining their formation and morale. Combat between the red vanguard and the blue picket is intense, with significant losses on both sides."
}
```

## Proposal B

```json
{
 "turn": 2,
 "units": [
  {
   "unitId": "blue-1",
   "x": 1960,
   "y": 1680,
   "facingDeg": 0,
   "formation": "line",
   "strength": 600,
   "morale": 80,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b1-1",
     "result": "carried-out"
    }
   ],
   "account": "Held position as ordered. Saw enemy cavalry approaching from the north.",
   "departure": ""
  },
  {
   "unitId": "blue-2",
   "x": 2140,
   "y": 1680,
   "facingDeg": 0,
   "formation": "line",
   "strength": 550,
   "morale": 75,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b2-1",
     "result": "carried-out"
    }
   ],
   "account": "Held position as ordered. Saw enemy infantry approaching from the south.",
   "departure": ""
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1250,
   "facingDeg": 180,
   "formation": "line",
   "strength": 162,
   "morale": 29,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b3-1",
     "result": "carried-out"
    }
   ],
   "account": "Held position as ordered. Saw enemy infantry approaching from the south.",
   "departure": "Departed from projected position due to combat losses."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1350,
   "facingDeg": 0,
   "formation": "column",
   "strength": 627,
   "morale": 72,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "r1-2",
     "result": "carried-out"
    }
   ],
   "account": "Advanced to the bridge as ordered. Engaged enemy cavalry.",
   "departure": ""
  },
  {
   "unitId": "red-2",
   "x": 2050,
   "y": 550,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 70,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r2-1",
     "result": "carried-out"
    }
   ],
   "account": "Held position as ordered.",
   "departure": ""
  },
  {
   "unitId": "red-3",
   "x": 1950,
   "y": 1300,
   "facingDeg": 160,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "r3-2",
     "result": "carried-out"
    }
   ],
   "account": "Rode on the Vanguard's right as ordered. Saw enemy cavalry approaching from the north.",
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
   "by": "red-1",
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
 "summary": "The battle continues with both sides engaging each other. The Blue cavalry unit, led by Maj. Verneuil, holds its position at the north end of the bridge. The Red infantry units, led by Col. Brandt and Col. Hartmann, advance towards the bridge and engage the Blue cavalry. The Red cavalry unit, led by Maj. von Reiter, rides on the Vanguard's right and cuts off the enemy horse if it tries to stand. The Blue infantry units, led by Col. Aubry and Col. Delacroix, hold their positions and engage the Red infantry. The combat is intense, with both sides suffering losses."
}
```

## Proposal C

```json
{
 "turn": 2,
 "units": [
  {
   "unitId": "blue-1",
   "x": 1960,
   "y": 1680,
   "facingDeg": 0,
   "formation": "line",
   "strength": 600,
   "morale": 80,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "The battalion maintained its position, holding the line as ordered. The enemy's advance was not yet a direct threat to our position.",
   "departure": ""
  },
  {
   "unitId": "blue-2",
   "x": 2140,
   "y": 1680,
   "facingDeg": 0,
   "formation": "line",
   "strength": 550,
   "morale": 75,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "The battalion remained in reserve, maintaining its defensive posture. The commander was cautious, waiting for the main thrust of the enemy to materialize before committing.",
   "departure": ""
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1250,
   "facingDeg": 180,
   "formation": "line",
   "strength": 162,
   "morale": 32,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b3-1",
     "result": "carried-out"
    }
   ],
   "account": "Following the order, the squadron held its position near the bridge, acting as a picket. When the enemy column advanced, the squadron engaged, suffering heavy losses in the skirmish.",
   "departure": "The unit engaged in combat, resulting in significant morale and strength losses, consistent with the projection."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1150,
   "facingDeg": 0,
   "formation": "column",
   "strength": 627,
   "morale": 72,
   "status": "active",
   "continuing": {
    "kind": "move",
    "x": 2050,
    "y": 1150
   },
   "orders": [
    {
     "orderId": "r1-2",
     "result": "carried-out"
    }
   ],
   "account": "The aggressive commander pressed the advance towards the bridge as ordered. The column engaged the enemy cavalry, taking heavy casualties but maintaining momentum.",
   "departure": "The unit advanced significantly towards the bridge, engaging the enemy cavalry in combat."
  },
  {
   "unitId": "red-2",
   "x": 2050,
   "y": 550,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 70,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "The battalion remained in its assigned position, awaiting further orders from command.",
   "departure": ""
  },
  {
   "unitId": "red-3",
   "x": 2150,
   "y": 1100,
   "facingDeg": 160,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "status": "active",
   "continuing": {
    "kind": "move",
    "x": 2150,
    "y": 1100
   },
   "orders": [
    {
     "orderId": "r3-2",
     "result": "carried-out"
    }
   ],
   "account": "The hussars executed the order, riding to the right flank of the vanguard column to screen and cut off any enemy cavalry attempting to exploit the advance.",
   "departure": "The unit moved to flank the advancing vanguard, fulfilling the order."
  }
 ],
 "observations": [
  {
   "side": "red",
   "unitId": "red-1",
   "by": "red-3",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "red-1",
   "by": "red-2",
   "when": "end"
  }
 ],
 "summary": "The Red forces initiated a strong advance. The Vanguard Battalion (red-1) moved aggressively towards the bridge, supported by the Hussars (red-3) who took up a flanking position. The Blue cavalry squadron (blue-3), positioned as a picket, met the advancing column. A fierce engagement ensued, with the cavalry suffering heavy losses while attempting to halt the column's momentum. The infantry units (blue-1 and blue-2) held their defensive lines, observing the action at the bridge. The Red Line Battalion (red-2) remained static, awaiting further orders."
}
```

## Proposal D

```json
{
 "turn": 2,
 "units": [
  {
   "unitId": "blue-1",
   "x": 1960,
   "y": 1680,
   "facingDeg": 0,
   "formation": "line",
   "strength": 600,
   "morale": 80,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Aubry held his line on the south bank as ordered, opened files to let the returning squadron pass to his rear, and watched the enemy column come down to the far end of the bridge, out of musket range."
  },
  {
   "unitId": "blue-2",
   "x": 2140,
   "y": 1680,
   "facingDeg": 0,
   "formation": "line",
   "strength": 550,
   "morale": 75,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Delacroix kept his battalion in line covering the bridge exit, not stirring a man, and watched enemy infantry and horse arrive on the far bank."
  },
  {
   "unitId": "blue-3",
   "x": 1980,
   "y": 1850,
   "facingDeg": 0,
   "formation": "line",
   "strength": 189,
   "morale": 76,
   "fatigue": 18,
   "ammo": 90,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b3-1",
     "result": "carried-out"
    }
   ],
   "account": "Maj. Verneuil held the picket and fired carbines at the enemy column as it came down the road, itching to charge. When the infantry pressed on and hussars swung round his left to cut him off, he did as written: fell back over the bridge at the trot, losing a few men to musketry and a brush with the hussars, and re-formed behind the 1st Battalion.",
   "departure": "The engine left the squadron standing in front of a battalion column for 13 minutes of fire until morale fell to 29. Its order says to fall back over the bridge if pressed by infantry, so it withdrew early with light losses (11 men, not 38) to behind the 1st Battalion, about 600 m from the projected spot."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1370,
   "facingDeg": 180,
   "formation": "column",
   "strength": 645,
   "morale": 79,
   "fatigue": 27,
   "ammo": 92,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r1-2",
     "result": "carried-out"
    }
   ],
   "account": "Col. Brandt marched the moment the order came, column down the high road. The enemy horse picket at the bridge fired carbines and then gave way before his leading companies' volleys, retiring over the bridge. He halted at the north end of the bridge, master of this bank, with enemy lines in sight beyond.",
   "departure": "Ammunition: the column fired only a few volleys at a picket that gave way, not 13 minutes of fire, so ammo stays at 92, not 30."
  },
  {
   "unitId": "red-2",
   "x": 2050,
   "y": 550,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 70,
   "fatigue": 10,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Hartmann, with no new orders, held his column on the road and rested his men."
  },
  {
   "unitId": "red-3",
   "x": 1950,
   "y": 1330,
   "facingDeg": 160,
   "formation": "line",
   "strength": 217,
   "morale": 85,
   "fatigue": 20,
   "ammo": 98,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r3-2",
     "result": "carried-out"
    }
   ],
   "account": "Maj. von Reiter rode on the column's right to get between the enemy horse and the bridge. The enemy did not stand: his leading troop caught their rear in a brief scuffle before they crossed. He drew rein at the river bank rather than follow onto a bridge covered by enemy infantry."
  }
 ],
 "observations": [
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
   "unitId": "blue-3",
   "when": "start"
  },
  {
   "side": "red",
   "by": "red-3",
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
   "side": "blue",
   "by": "blue-1",
   "unitId": "red-1",
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
   "unitId": "red-1",
   "when": "end"
  },
  {
   "side": "blue",
   "by": "blue-2",
   "unitId": "red-3",
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
   "unitId": "red-3",
   "when": "end"
  },
  {
   "side": "red",
   "by": "red-1",
   "unitId": "blue-1",
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
   "by": "red-1",
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
 "summary": "Turn 2 (20-40). Red's Vanguard Battalion marched down the high road on receiving its order at minute 4, with the hussars riding on its right. The Blue cavalry picket at the north end of the bridge fired carbines at the column, then, pressed by infantry and with hussars working round its flank, followed its standing order and fell back over the bridge, losing 11 men in the exchange and a brief brush with the hussars. It re-formed behind the 1st Battalion. By minute 40 the Vanguard holds the north end of the bridge in column, with the hussars beside it on the bank. Red's Line Battalion stayed in reserve on the road. Blue's two battalions hold their line on the south bank, about 320 m from the bridge's north end, so no fire was exchanged across the river. The bridge itself is uncontested."
}
```

## Proposal E

```json
{
 "turn": 2,
 "units": [
  {
   "unitId": "blue-1",
   "x": 1960,
   "y": 1680,
   "facingDeg": 0,
   "formation": "line",
   "strength": 600,
   "morale": 80,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Aubry keeps his battalion in line south of the river, facing the bridge, as before. He sees the enemy column come down to the far end of the bridge and the horse fall back through to his rear, and holds his fire since nothing is yet within 200 m."
  },
  {
   "unitId": "blue-2",
   "x": 2140,
   "y": 1680,
   "facingDeg": 0,
   "formation": "line",
   "strength": 550,
   "morale": 75,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Delacroix stays in line beside the 1st Battalion and does not commit his reserve. He watches the enemy halt at the far end of the bridge and waits for them to make the first move."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1760,
   "facingDeg": 0,
   "formation": "line",
   "strength": 188,
   "morale": 68,
   "fatigue": 15,
   "ammo": 85,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b3-1",
     "result": "carried-out"
    }
   ],
   "account": "Maj. Verneuil held the north end of the bridge as ordered and watched the road. When the enemy column came within carbine range and hussars appeared on its flank, he exchanged a few shots, then, being pressed by infantry as his orders foresaw, drew off over the bridge and re-formed behind the 1st Battalion. He would rather have charged, but obeyed.",
   "departure": "Projection has the squadron stand at 100 m from a formed column and be shot down to 162 men and morale 29. Verneuil's orders say to fall back over the bridge if pressed by infantry, and the fast horse can cross 500 m in a couple of minutes, so he disengages after a brief exchange instead. Position, losses and morale therefore differ."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1400,
   "facingDeg": 180,
   "formation": "column",
   "strength": 638,
   "morale": 78,
   "fatigue": 28,
   "ammo": 85,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r1-2",
     "result": "carried-out"
    }
   ],
   "account": "Col. Brandt marched down the high road at once, brushed the enemy picket of horse off the road with a few volleys so that it fell back over the bridge, and halted his column at the north end of the bridge. He holds there, deploying his front companies, rather than throw the column onto the bridge under the fire of the line beyond.",
   "departure": "Projection puts the column at (2050,1350) with 627 men and 30% ammo after a long fight with the cavalry; here the cavalry withdraws, so the fight is short, losses are 12, ammo is higher, and the column halts at the bridge head (about 50 m from the projection)."
  },
  {
   "unitId": "red-2",
   "x": 2050,
   "y": 550,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 70,
   "fatigue": 7,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Hartmann has no new orders and stays where he was, by the book, with his column on the road."
  },
  {
   "unitId": "red-3",
   "x": 1960,
   "y": 1380,
   "facingDeg": 180,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "fatigue": 8,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r3-2",
     "result": "carried-out"
    }
   ],
   "account": "Maj. von Reiter rode down on the right of the Vanguard as ordered. The enemy horse drew back over the bridge before he could cut it off. He halts on the river bank and does not follow onto the bridge against the infantry beyond."
  }
 ],
 "observations": [
  {
   "side": "blue",
   "by": "blue-3",
   "unitId": "red-1",
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
   "unitId": "blue-3",
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
   "unitId": "red-1",
   "when": "end"
  },
  {
   "side": "blue",
   "by": "blue-2",
   "unitId": "red-3",
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
   "unitId": "red-3",
   "when": "end"
  },
  {
   "side": "red",
   "by": "red-1",
   "unitId": "blue-1",
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
   "by": "red-1",
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
 "summary": "The Red vanguard column came down the high road and met the Blue cavalry picket at the north end of the bridge. After a short exchange of fire the picket, pressed by infantry as its orders foresaw, fell back over the bridge and re-formed behind the 1st Battalion. Red hussars rode on the column's right but could not cut it off. Red-1 halted at the bridge head and Red-3 on the river bank. Blue infantry held their line south of the river, out of range. Losses were light: about 12 Red infantry and about 12 Blue horse. The projection kept the cavalry standing and destroyed it; the umpire let it obey its orders to withdraw."
}
```

## Proposal F

```json
{
 "turn": 2,
 "units": [
  {
   "unitId": "blue-1",
   "x": 1960,
   "y": 1680,
   "facingDeg": 0,
   "formation": "line",
   "strength": 600,
   "morale": 80,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "The 1st Battalion acted as the staff tables direct."
  },
  {
   "unitId": "blue-2",
   "x": 2140,
   "y": 1680,
   "facingDeg": 0,
   "formation": "line",
   "strength": 550,
   "morale": 75,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "The 2nd Battalion acted as the staff tables direct."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1250,
   "facingDeg": 180,
   "formation": "line",
   "strength": 162,
   "morale": 29,
   "fatigue": 21,
   "ammo": 65,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b3-1",
     "result": "carried-out"
    }
   ],
   "account": "The Cavalry Squadron acted as the staff tables direct."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1350,
   "facingDeg": 0,
   "formation": "column",
   "strength": 627,
   "morale": 72,
   "fatigue": 37,
   "ammo": 30,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "r1-2",
     "result": "carried-out"
    }
   ],
   "account": "The Vanguard Battalion acted as the staff tables direct."
  },
  {
   "unitId": "red-2",
   "x": 2050,
   "y": 550,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 70,
   "fatigue": 7,
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
   "x": 1950,
   "y": 1300,
   "facingDeg": 160,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "fatigue": 2,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "r3-2",
     "result": "carried-out"
    }
   ],
   "account": "The Hussar Squadron acted as the staff tables direct."
  }
 ],
 "observations": [],
 "summary": "The turn was resolved by the tables."
}
```
