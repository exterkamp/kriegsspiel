# Case courier-mid-turn: An order that arrives at minute 14, and one still on the road

**What this case tests.** Blue-2 is ordered to shift west to support the 1st; the order reaches it only at minute 14, so it can move at most 6 minutes of march. Blue-1's order is still riding (due minute 6 of turn 3) and must be marked not-arrived and not acted on. Red-1 closes on the bridge from the north.

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
   "y": 950,
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
   "x": 2250,
   "y": 700,
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
   "orderId": "blue-b2-7",
   "side": "blue",
   "to": "blue-2",
   "text": "Move your battalion across behind the 1st, to the west of the road, and form line facing the bridge.",
   "courier": "safe",
   "sentAtMinute": 20,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 14
  },
  {
   "orderId": "blue-b1-7",
   "side": "blue",
   "to": "blue-1",
   "text": "Advance to the south end of the bridge and hold it.",
   "courier": "safe",
   "sentAtMinute": 20,
   "status": "on-the-road",
   "dueAtMinute": 46
  },
  {
   "orderId": "red-r1-7",
   "side": "red",
   "to": "red-1",
   "text": "Continue to the bridge and seize it.",
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
     "kind": "hold"
    },
    "at": "near the bridge, west of the High road"
   },
   {
    "unitId": "blue-2",
    "x": 2050,
    "y": 1500,
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
    "at": "at the bridge, on the High road",
    "path": [
     [
      2140,
      1680
     ],
     [
      2066,
      1613
     ],
     [
      2050,
      1500
     ]
    ]
   },
   {
    "unitId": "blue-3",
    "x": 2050,
    "y": 1850,
    "facingDeg": 0,
    "formation": "line",
    "strength": 200,
    "morale": 85,
    "fatigue": 0,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    },
    "at": "near the bridge, on the High road"
   },
   {
    "unitId": "red-1",
    "x": 2050,
    "y": 950,
    "facingDeg": 180,
    "formation": "column",
    "strength": 650,
    "morale": 80,
    "fatigue": 7,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    },
    "at": "near the bridge, on the High road"
   },
   {
    "unitId": "red-2",
    "x": 2250,
    "y": 700,
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
    "at": "east of the High road"
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
    "at": "near the Northern wood"
   }
  ],
  "observations": [
   {
    "side": "blue",
    "unitId": "red-1",
    "by": "blue-2",
    "when": "end"
   },
   {
    "side": "red",
    "unitId": "blue-2",
    "by": "red-1",
    "when": "end"
   }
  ],
  "events": [
   "23: order_delivered red-1, orderId red-r1-7",
   "34: order_delivered blue-2, orderId blue-b2-7",
   "36: unit.arrived blue-2"
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
   "strength": 590,
   "morale": 79,
   "fatigue": 0,
   "ammo": 97,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "blue-b1-7",
     "result": "not-arrived"
    }
   ],
   "account": "The orders to advance to the bridge have not reached Colonel Aubry. He stood in line west of the road, as before. Towards the end of the turn a French column came down on the bridge, 150 paces off. He held his ground and gave it a volley."
  },
  {
   "unitId": "blue-2",
   "x": 1900,
   "y": 1730,
   "facingDeg": 30,
   "formation": "line",
   "strength": 550,
   "morale": 75,
   "fatigue": 3,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "blue-b2-7",
     "result": "carried-out"
    }
   ],
   "account": "The order reached Colonel Delacroix with six minutes of the turn left. He marched the battalion across behind the 1st, west of the road, and formed line facing the bridge, just short of the 1st's flank. He did not push forward. He saw the enemy column on the bridge and kept his line steady.",
   "departure": "The projection put the battalion on the bridge itself. The order says west of the road, behind the 1st, in line facing the bridge, and the commander is cautious. He therefore ends about 250 m from his start, not at the bridge."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1850,
   "facingDeg": 0,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "No new orders. Major Verneuil held on the road behind the infantry. He watched the enemy column come onto the bridge and kept the squadron ready, though he is impatient to charge."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1560,
   "facingDeg": 180,
   "formation": "column",
   "strength": 625,
   "morale": 78,
   "fatigue": 25,
   "ammo": 97,
   "status": "active",
   "continuing": {
    "kind": "move",
    "x": 2050,
    "y": 1500
   },
   "orders": [
    {
     "orderId": "red-r1-7",
     "result": "carried-out"
    }
   ],
   "account": "The order reached Colonel Brandt at about minute 23. He marched down the High road in column and went onto the bridge. At the south end he met a blue line close ahead and took its volley. He kept pressing for the far bank, as ordered.",
   "departure": "The projection kept the battalion standing at y=950. The order to seize the bridge reached an aggressive commander 550 m from it, and he would march at once down the road. He ends on the bridge, in fire range of the blue line, with a small loss from the exchange."
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 700,
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
   "account": "No orders have reached Colonel Hartmann. He waited in column east of the road, as before."
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
   "account": "No orders. Major von Reiter held by the Northern wood and saw nothing."
  }
 ],
 "observations": [
  {
   "side": "blue",
   "unitId": "red-1",
   "by": "blue-1",
   "when": "end"
  },
  {
   "side": "blue",
   "unitId": "red-1",
   "by": "blue-2",
   "when": "end"
  },
  {
   "side": "blue",
   "unitId": "red-1",
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
 "summary": "Red-1 marched down the High road on the bridge, and blue-2 moved west behind blue-1 and formed line facing the bridge. Red-1 ends on the bridge at y=1560, and an exchange of fire with blue-1 begins at the end. Red-1 loses about 25 men and blue-1 about 10. Blue-1's order to hold the south end of the bridge is still on the road and has not been acted on. Blue-3, red-2 and red-3 held. The engine held red-1 back at y=950, against its order, and I overrode that. I also kept blue-2 off the bridge, since its order put it west of the road. Next turn, expect blue-1's order to arrive, a fight at the south end of the bridge, and possibly an early charge by blue-3's cavalry.",
 "precedents": [
  "A unit given an order to seize an objective on arrival marches at once at full road pace; it does not stand idle."
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
   "orders": [
    {
     "orderId": "blue-b1-7",
     "result": "not-arrived"
    }
   ],
   "account": "Col. Aubry holds his line west of the road as last ordered. Toward the end of the turn an enemy column comes down to the far end of the bridge, still out of musket range. He waits for orders and does not open fire.",
   "departure": ""
  },
  {
   "unitId": "blue-2",
   "x": 2040,
   "y": 1765,
   "facingDeg": 250,
   "formation": "column",
   "strength": 550,
   "morale": 75,
   "fatigue": 2,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "move",
    "x": 1960,
    "y": 1790
   },
   "orders": [
    {
     "orderId": "blue-b2-7",
     "result": "partly"
    }
   ],
   "account": "Col. Delacroix receives the order six minutes before the turn ends. He breaks his line into column and leads it south-west, behind the 1st Battalion and across the road. He is still on the march at the end, and will form line facing the bridge once he is in place.",
   "departure": "The order says to move behind the 1st and west of the road. The projection put the battalion on the bridge itself, in front of the 1st, which is a misreading of the order. The order also arrived with only six minutes left, so a cautious colonel is only part-way to the place behind the 1st Battalion."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1850,
   "facingDeg": 0,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Maj. Verneuil holds on the road behind the infantry. He has the enemy column at the bridge in sight across the river. He has no order to move and stays where he is, impatiently."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1420,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 80,
   "fatigue": 22,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "move",
    "x": 2050,
    "y": 1580
   },
   "orders": [
    {
     "orderId": "red-r1-7",
     "result": "partly"
    }
   ],
   "account": "Col. Brandt has the order early in the turn and puts his column down the high road at once. By the end the head of the column is at the north end of the bridge. He can see two enemy battalions in line across the river and horse behind them. He closes up his column to push over the bridge.",
   "departure": "The order arrived at minute 3 and Brandt is aggressive. On the road he covers the 470 m to the north end of the bridge easily within the turn. The projection left him idle at his start point, which is wrong. He is not yet within musket range of the enemy line, so there is no fire."
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 700,
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
   "account": "Col. Hartmann has no new orders and stays in column east of the road, waiting for orders by the book. His men rest."
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
   "account": "Maj. von Reiter has no new orders and holds by the northern wood."
  }
 ],
 "observations": [
  {
   "side": "blue",
   "unitId": "red-1",
   "by": "blue-1",
   "when": "end"
  },
  {
   "side": "blue",
   "unitId": "red-1",
   "by": "blue-2",
   "when": "end"
  },
  {
   "side": "blue",
   "unitId": "red-1",
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
 "summary": "Red-1 marched on its arrived order and ends in column at the north end of the bridge (2050,1420), set to push across next turn. Blue-2 got its order late and is in column moving to 1960,1790, behind Blue-1 and west of the road, where it will form line facing the bridge; the projection's placing of it on the bridge was rejected as a misreading. Blue-1 holds at 1960,1680; its order to advance to the south end of the bridge is due at minute 46. No fire was exchanged, since Red-1 at the bridge end is about 275 m from Blue-1 and out of range. Red-2 and Red-3 have no orders and hold. Blue-3 holds on the road at 2050,1850. Both sides now see each other across the river at the bridge.",
 "precedents": [
  "A unit on the high road with an arrived order marches at road pace; the tables may not leave it idle when its order says to advance."
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
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "blue-b1-7",
     "result": "not-arrived"
    }
   ],
   "account": "The 1st Battalion acted as the staff tables direct."
  },
  {
   "unitId": "blue-2",
   "x": 2050,
   "y": 1500,
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
   "orders": [
    {
     "orderId": "blue-b2-7",
     "result": "carried-out"
    }
   ],
   "account": "The 2nd Battalion acted as the staff tables direct."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1850,
   "facingDeg": 0,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "The Cavalry Squadron acted as the staff tables direct."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 950,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 80,
   "fatigue": 7,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "red-r1-7",
     "result": "carried-out"
    }
   ],
   "account": "The Vanguard Battalion acted as the staff tables direct."
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 700,
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
 "observations": [
  {
   "side": "blue",
   "unitId": "red-1",
   "by": "blue-2",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "blue-2",
   "by": "red-1",
   "when": "end"
  }
 ],
 "summary": "The turn was resolved by the tables."
}
```
