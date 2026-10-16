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
   "orderId": "blue-b3-1",
   "side": "blue",
   "to": "blue-3",
   "text": "Hold the north end of the bridge as a picket. Watch the road. If pressed by infantry, fall back over the bridge and re-form behind the 1st Battalion.",
   "courier": "safe",
   "sentAtMinute": 0,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 0
  },
  {
   "orderId": "red-r1-2",
   "side": "red",
   "to": "red-1",
   "text": "Advance to the bridge. Drive off any pickets on this bank.",
   "courier": "fast",
   "sentAtMinute": 20,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 4
  },
  {
   "orderId": "red-r3-2",
   "side": "red",
   "to": "red-3",
   "text": "Ride on the Vanguard's right and cut off the enemy horse if it tries to stand.",
   "courier": "fast",
   "sentAtMinute": 20,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 3
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
     "kind": "idle"
    },
    "at": "near the bridge, west of the High road"
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
     "kind": "idle"
    },
    "at": "near the bridge, east of the High road"
   },
   {
    "unitId": "blue-3",
    "x": 2050,
    "y": 1250,
    "facingDeg": 0,
    "formation": "line",
    "strength": 200,
    "morale": 85,
    "fatigue": 0,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "idle"
    },
    "at": "near the bridge, on the High road",
    "contacts": [
     "red-1"
    ]
   },
   {
    "unitId": "red-1",
    "x": 2050,
    "y": 1500,
    "facingDeg": 180,
    "formation": "column",
    "strength": 650,
    "morale": 80,
    "fatigue": 12,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "idle"
    },
    "at": "at the bridge, on the High road",
    "path": [
     [
      2050,
      850
     ],
     [
      2050,
      1100
     ],
     [
      2050,
      1500
     ]
    ],
    "contacts": [
     "blue-3"
    ]
   },
   {
    "unitId": "red-2",
    "x": 2050,
    "y": 550,
    "facingDeg": 180,
    "formation": "column",
    "strength": 650,
    "morale": 70,
    "fatigue": 11,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "idle"
    },
    "at": "on the High road"
   },
   {
    "unitId": "red-3",
    "x": 1800,
    "y": 900,
    "facingDeg": 160,
    "formation": "line",
    "strength": 220,
    "morale": 85,
    "fatigue": 6,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "idle"
    },
    "at": "west of the High road"
   }
  ],
  "observations": [
   {
    "side": "blue",
    "unitId": "red-1",
    "by": "blue-3",
    "when": "start"
   },
   {
    "side": "blue",
    "unitId": "red-2",
    "by": "blue-3",
    "when": "start"
   },
   {
    "side": "blue",
    "unitId": "red-3",
    "by": "blue-3",
    "when": "start"
   },
   {
    "side": "red",
    "unitId": "blue-1",
    "by": "red-3",
    "when": "start"
   },
   {
    "side": "red",
    "unitId": "blue-3",
    "by": "red-1",
    "when": "start"
   },
   {
    "side": "blue",
    "unitId": "red-1",
    "by": "blue-1",
    "when": "end"
   },
   {
    "side": "blue",
    "unitId": "red-2",
    "by": "blue-3",
    "when": "end"
   },
   {
    "side": "blue",
    "unitId": "red-3",
    "by": "blue-3",
    "when": "end"
   },
   {
    "side": "red",
    "unitId": "blue-1",
    "by": "red-1",
    "when": "end"
   },
   {
    "side": "red",
    "unitId": "blue-2",
    "by": "red-1",
    "when": "end"
   },
   {
    "side": "red",
    "unitId": "blue-3",
    "by": "red-1",
    "when": "end"
   }
  ],
  "events": [
   "20: order_delivered blue-3, orderId blue-b3-1",
   "23: order_delivered red-3, orderId red-r3-2",
   "24: order_delivered red-1, orderId red-r1-2",
   "25: contact.begin blue-3 v red-1",
   "27: unit.arrived red-1",
   "27: contact.end",
   "37: game.end reason objective-taken, winner red"
  ],
  "outcome": {
   "winner": "red",
   "reason": "objective-taken",
   "atMin": 37
  }
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
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Aubry kept his battalion in line south of the river, facing the bridge. He saw the enemy column come down the road to the north bank and held fire, the range being too long. He awaits further orders."
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
   "account": "Col. Delacroix stayed in line east of the road with the reserve in hand. He saw the enemy column on the north bank and committed nothing. He has the bridge under his eye."
  },
  {
   "unitId": "blue-3",
   "x": 2000,
   "y": 1760,
   "facingDeg": 0,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "fatigue": 5,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "blue-b3-1",
     "result": "carried-out"
    }
   ],
   "account": "Maj. Verneuil watched the road from the north end of the bridge. When the enemy infantry column came down on him with hussars on the west flank, he fell back over the bridge as ordered and re-formed behind the 1st Battalion. He did not charge, though it galled him.",
   "departure": "The projection leaves the cavalry on the north bank in contact with a column. His order says to fall back over the bridge if pressed by infantry. He is a picket against a battalion, so he withdraws to the south bank, 500 m from the projected position."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1420,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 80,
   "fatigue": 13,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "move",
    "x": 2050,
    "y": 1500
   },
   "orders": [
    {
     "orderId": "red-r1-2",
     "result": "carried-out"
    }
   ],
   "account": "Col. Brandt got his order at about the fourth minute and moved down the High road in column. The enemy picket fell back over the bridge. He halted at the north end, short of the span. Two enemy battalions in line lie 200 m beyond it. He is closing up and will take the bridge next."
  },
  {
   "unitId": "red-2",
   "x": 2050,
   "y": 550,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 70,
   "fatigue": 5,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Hartmann had no new order and stayed on the High road, waiting for instructions."
  },
  {
   "unitId": "red-3",
   "x": 1960,
   "y": 1340,
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
   "orders": [
    {
     "orderId": "red-r3-2",
     "result": "carried-out"
    }
   ],
   "account": "Maj. von Reiter rode down on the Vanguard's right to the river bank. The enemy horse withdrew over the bridge before he could cut it off. He halted on the bank, since the river stops him and the enemy infantry is near.",
   "departure": "The projection leaves the hussars idle at 1800,900. His order is to ride on the Vanguard's right, so he moves with the column to the north bank, 450 m from the projected position."
  }
 ],
 "observations": [
  {
   "side": "blue",
   "unitId": "red-1",
   "by": "blue-3",
   "when": "start"
  },
  {
   "side": "blue",
   "unitId": "red-2",
   "by": "blue-3",
   "when": "start"
  },
  {
   "side": "blue",
   "unitId": "red-3",
   "by": "blue-3",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-1",
   "by": "red-3",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-3",
   "by": "red-1",
   "when": "start"
  },
  {
   "side": "blue",
   "unitId": "red-1",
   "by": "blue-1",
   "when": "end"
  },
  {
   "side": "blue",
   "unitId": "red-3",
   "by": "blue-1",
   "when": "end"
  },
  {
   "side": "blue",
   "unitId": "red-1",
   "by": "blue-3",
   "when": "end"
  },
  {
   "side": "blue",
   "unitId": "red-3",
   "by": "blue-3",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "blue-1",
   "by": "red-1",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "blue-2",
   "by": "red-1",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "blue-1",
   "by": "red-3",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "blue-2",
   "by": "red-3",
   "when": "end"
  }
 ],
 "summary": "The Red Vanguard (red-1) came down the High road and halted on the north bank at about y=1420, short of the bridge. Blue's cavalry picket (blue-3) fell back over the bridge to the south bank, as its order directed, and stands behind blue-1. The Red hussars (red-3) are on the river bank west of the road. Red's second battalion (red-2) stays at 2050,550 with no order. Blue's two battalions hold in line at y=1680. No fire was exchanged, since the range was over 200 m. I did not accept the engine's finding that the objective was taken at minute 37. No Red unit has crossed the bridge or stood on the objective, and Blue's infantry cover it at 180 m. Next turn: red-1 will try to take the bridge in column under fire from blue-1 and blue-2.",
 "precedents": [
  "A picket cavalry ordered to fall back if pressed by infantry withdraws once a formed battalion closes within about 400 m.",
  "The objective is not taken merely because a unit is projected onto it; it must get there against formed infantry covering it."
 ]
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
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Aubry held his line south of the bridge as ordered. Our horse came back over the bridge and formed in his rear. An enemy column halted at the far bridgehead with hussars on its flank. They were beyond effective musket range, so he held his fire.",
   "departure": "Continues to hold rather than going idle; same position."
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
   "account": "Col. Delacroix kept his battalion in line east of the road and watched the enemy column come up to the far end of the bridge. With no new orders and the enemy out of range, he stayed where he was.",
   "departure": "Continues to hold rather than going idle; same position."
  },
  {
   "unitId": "blue-3",
   "x": 1960,
   "y": 1800,
   "facingDeg": 0,
   "formation": "line",
   "strength": 196,
   "morale": 82,
   "fatigue": 6,
   "ammo": 98,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "blue-b3-1",
     "result": "carried-out"
    }
   ],
   "account": "Maj. Verneuil picketed the road north of the bridge. A strong enemy column came down the road with hussars on its right. He was pressed by infantry, and his orders said what to do, so he exchanged a few carbine shots and took the squadron back over the bridge before the hussars could close. He re-formed behind the 1st Battalion. A handful of men were hit.",
   "departure": "The projection left the picket standing on the road while the enemy column marched through it. Its order said to fall back over the bridge if pressed by infantry, so it did; it ends 550 m south."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1410,
   "facingDeg": 180,
   "formation": "column",
   "strength": 648,
   "morale": 80,
   "fatigue": 17,
   "ammo": 98,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "red-r1-2",
     "result": "carried-out"
    }
   ],
   "account": "Col. Brandt marched at once down the road. His skirmishers pushed the enemy horse picket off this bank, and it withdrew over the bridge. He halted at the north end of the bridge. Two enemy battalions stood in line on the far bank, so he did not file his column across under their muskets.",
   "departure": "The order was to advance to the bridge and clear this bank. Brandt reached the north bridgehead and did not carry a column onto the span against two formed battalions without orders. He ends 90 m short of the projected position, off the objective."
  },
  {
   "unitId": "red-2",
   "x": 2050,
   "y": 550,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 70,
   "fatigue": 11,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Hartmann had no new orders, so he kept his column halted on the road and let the men rest."
  },
  {
   "unitId": "red-3",
   "x": 1920,
   "y": 1340,
   "facingDeg": 170,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "fatigue": 14,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "red-r3-2",
     "result": "carried-out"
    }
   ],
   "account": "Maj. von Reiter rode down on the right of the vanguard to cut off the enemy horse. It did not stand but went back over the bridge before he could reach it. He halted at the river bank west of the road; the river is impassable there and the column held the bridge.",
   "departure": "The projection left the squadron idle at its start. Its order had arrived and it rode with the vanguard as ordered, ending about 460 m south-east at the river bank."
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
   "by": "red-3",
   "unitId": "blue-1",
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
   "by": "red-1",
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
 "summary": "The Blue cavalry picket was pressed by the Red vanguard column; following its order, it fell back over the bridge with trifling loss and re-formed behind blue-1 at 1960,1800. Red-1 cleared the north bank and halted in column at the north bridgehead (2050,1410), off the objective; Col. Brandt was ordered only to advance to the bridge and clear this bank, and did not carry his column across under two formed Blue battalions. Red-3 rode on the vanguard's right to the river bank at 1920,1340 but could not cut off the Blue horse, which did not stand. Blue-1 and blue-2 hold in line at y=1680, about 280 m from the bridgehead and out of effective range; no fire was exchanged. Red-2 stands rested on the road at y=550 without orders. I overrode the projection's capture of the objective at minute 37: it rested on a column marching through a standing picket and halting on the span unopposed.",
 "precedents": [
  "A unit ordered to advance 'to the bridge' halts at the near bridgehead; it does not cross onto the span under formed enemy fire without an explicit order to cross.",
  "A column marching into a standing picket does not pass through it: the picket retires or fights as its orders say."
 ]
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
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "idle"
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
    "kind": "idle"
   },
   "orders": [],
   "account": "The 2nd Battalion acted as the staff tables direct."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1250,
   "facingDeg": 0,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "blue-b3-1",
     "result": "carried-out"
    }
   ],
   "account": "The Cavalry Squadron acted as the staff tables direct."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1500,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 80,
   "fatigue": 12,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "red-r1-2",
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
   "fatigue": 11,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [],
   "account": "The Line Battalion acted as the staff tables direct."
  },
  {
   "unitId": "red-3",
   "x": 1800,
   "y": 900,
   "facingDeg": 160,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "fatigue": 6,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "red-r3-2",
     "result": "carried-out"
    }
   ],
   "account": "The Hussar Squadron acted as the staff tables direct."
  }
 ],
 "observations": [
  {
   "side": "blue",
   "unitId": "red-1",
   "by": "blue-3",
   "when": "start"
  },
  {
   "side": "blue",
   "unitId": "red-2",
   "by": "blue-3",
   "when": "start"
  },
  {
   "side": "blue",
   "unitId": "red-3",
   "by": "blue-3",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-1",
   "by": "red-3",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-3",
   "by": "red-1",
   "when": "start"
  },
  {
   "side": "blue",
   "unitId": "red-1",
   "by": "blue-1",
   "when": "end"
  },
  {
   "side": "blue",
   "unitId": "red-2",
   "by": "blue-3",
   "when": "end"
  },
  {
   "side": "blue",
   "unitId": "red-3",
   "by": "blue-3",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "blue-1",
   "by": "red-1",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "blue-2",
   "by": "red-1",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "blue-3",
   "by": "red-1",
   "when": "end"
  }
 ],
 "summary": "The turn was resolved by the tables."
}
```
