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
   "orderId": "b2-7",
   "side": "blue",
   "to": "blue-2",
   "text": "Move your battalion across behind the 1st, to the west of the road, and form line facing the bridge.",
   "courier": "safe",
   "sentTurn": 2,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 14
  },
  {
   "orderId": "b1-7",
   "side": "blue",
   "to": "blue-1",
   "text": "Advance to the south end of the bridge and hold it.",
   "courier": "safe",
   "sentTurn": 2,
   "status": "on-the-road",
   "dueTurn": 3,
   "dueMinuteOfTurn": 6
  },
  {
   "orderId": "r1-7",
   "side": "red",
   "to": "red-1",
   "text": "Continue to the bridge and seize it.",
   "courier": "fast",
   "sentTurn": 2,
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
    }
   },
   {
    "unitId": "blue-2",
    "x": 1820,
    "y": 1700,
    "facingDeg": 0,
    "formation": "line",
    "strength": 550,
    "morale": 75,
    "fatigue": 0,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "idle"
    }
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
    }
   },
   {
    "unitId": "red-1",
    "x": 2050,
    "y": 1380,
    "facingDeg": 180,
    "formation": "column",
    "strength": 650,
    "morale": 80,
    "fatigue": 8,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "idle"
    }
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
   "minute 5: unit.arrived {\"unitId\":\"red-1\",\"at\":[2050,1380]}",
   "minute 17: unit.arrived {\"unitId\":\"blue-2\",\"at\":[1820,1700]}"
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
     "orderId": "b1-7",
     "result": "not-arrived"
    }
   ],
   "account": "Col. Aubry, cautious and methodical, held his position as ordered, awaiting further instructions."
  },
  {
   "unitId": "blue-2",
   "x": 1820,
   "y": 1700,
   "facingDeg": 0,
   "formation": "line",
   "strength": 550,
   "morale": 75,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "b2-7",
     "result": "partly"
    }
   ],
   "account": "Col. Delacroix, cautious, moved his battalion to the west of the road, but did not fully form up as ordered due to the terrain."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1850,
   "facingDeg": 0,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b1-7",
     "result": "not-arrived"
    }
   ],
   "account": "Maj. Verneuil, bold and impatient, remained in position as he was cautious about overextending his cavalry."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1380,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 80,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "r1-7",
     "result": "carried-out"
    }
   ],
   "account": "Col. Brandt, aggressive, pressed forward and seized the bridge, but took some casualties in the process."
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 700,
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
     "orderId": "b2-7",
     "result": "not-arrived"
    }
   ],
   "account": "Col. Hartmann, by the book, held his position as ordered, awaiting further instructions."
  },
  {
   "unitId": "red-3",
   "x": 1550,
   "y": 400,
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
     "orderId": "b1-7",
     "result": "not-arrived"
    }
   ],
   "account": "Maj. von Reiter, dashing scout, remained in position as he was cautious about overextending his cavalry."
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
   "by": "blue-1",
   "when": "end"
  },
  {
   "side": "blue",
   "unitId": "blue-3",
   "by": "blue-1",
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
   "by": "red-1",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "red-3",
   "by": "red-1",
   "when": "end"
  }
 ],
 "summary": "In this turn, the red vanguard battalion under Col. Brandt seized the bridge, while the blue units held their positions. The cautious Col. Delacroix moved his battalion to the west of the road but did not fully form up as ordered. The aggressive Col. Brandt pressed forward and seized the bridge, taking some casualties. The blue cavalry remained in position, while the red hussars also held their ground. The bridge is now in red hands, and the battle is likely to intensify in the next turn."
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
     "orderId": "b1-7",
     "result": "not-arrived"
    }
   ],
   "account": "Colonel Aubry held his line as ordered, but his men are getting restless.",
   "departure": ""
  },
  {
   "unitId": "blue-2",
   "x": 1820,
   "y": 1700,
   "facingDeg": 0,
   "formation": "line",
   "strength": 550,
   "morale": 75,
   "status": "active",
   "continuing": {
    "kind": "move",
    "x": 2050,
    "y": 1680
   },
   "orders": [
    {
     "orderId": "b2-7",
     "result": "carried-out"
    }
   ],
   "account": "Colonel Delacroix moved his battalion as ordered, but it's a bit of a tight squeeze.",
   "departure": ""
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1850,
   "facingDeg": 0,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Major Verneuil held his ground, but his men are getting a bit anxious.",
   "departure": ""
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1380,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 80,
   "status": "active",
   "continuing": {
    "kind": "move",
    "x": 2050,
    "y": 1500
   },
   "orders": [
    {
     "orderId": "r1-7",
     "result": "carried-out"
    }
   ],
   "account": "Colonel Brandt moved his battalion as ordered, but it's a bit of a tight squeeze.",
   "departure": ""
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 700,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 70,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Colonel Hartmann held his ground, but his men are getting a bit anxious.",
   "departure": ""
  },
  {
   "unitId": "red-3",
   "x": 1550,
   "y": 400,
   "facingDeg": 180,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "status": "active",
   "continuing": {
    "kind": "move",
    "x": 2050,
    "y": 1500
   },
   "orders": [],
   "account": "Major von Reiter moved his squadron as ordered, but it's a bit of a long way.",
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
 "summary": "The battle continues with both sides holding their ground. The Blue forces are trying to outflank the Red forces, while the Red forces are trying to seize the bridge. The cavalry on both sides are getting restless, but so far no one has made a decisive move."
}
```

## Proposal C

```json
{
 "turn": 2,
 "units": [
  {
   "unitId": "blue-1",
   "x": 2030,
   "y": 1600,
   "facingDeg": 0,
   "formation": "line",
   "strength": 560,
   "morale": 75,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b1-7",
     "result": "carried-out"
    }
   ],
   "account": "Col. Aubry, being literal, moved his battalion steadily towards the south end of the bridge as ordered. Upon reaching the vicinity, he engaged the advancing enemy force, sustaining moderate losses but holding his ground firmly.",
   "departure": "Moved significantly towards the bridge and engaged the enemy, contrary to the projection."
  },
  {
   "unitId": "blue-2",
   "x": 1850,
   "y": 1700,
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
     "orderId": "b2-7",
     "result": "carried-out"
    }
   ],
   "account": "Col. Delacroix, being cautious, executed the movement slowly, positioning his battalion to the west and slightly behind the 1st Battalion, forming a line to support the main defensive position near the bridge.",
   "departure": "Moved significantly to the west flank, contrary to the projection."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1850,
   "facingDeg": 0,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Maj. Verneuil maintained his position, holding the high ground and observing the enemy movements below, ready to exploit any opportunity.",
   "departure": "No departure."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1350,
   "facingDeg": 0,
   "formation": "column",
   "strength": 600,
   "morale": 75,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r1-7",
     "result": "carried-out"
    }
   ],
   "account": "Col. Brandt, being aggressive, pressed his battalion rapidly towards the bridge. Upon arrival, he immediately engaged the defending blue unit, seizing the critical position despite taking losses in the initial clash.",
   "departure": "Moved significantly towards the bridge and engaged the enemy, contrary to the projection."
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 700,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 70,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Hartmann maintained his position, adhering strictly to the defensive plan and awaiting further orders from HQ.",
   "departure": "No departure."
  },
  {
   "unitId": "red-3",
   "x": 1550,
   "y": 400,
   "facingDeg": 180,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Maj. von Reiter held his scouting position, maintaining vigilance over the northern approaches, though he did not press forward.",
   "departure": "No departure."
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
  }
 ],
 "summary": "The Red forces launched a determined push towards the objective. R1, driven by aggression, advanced rapidly and successfully reached the bridge area, engaging B1. The resulting clash saw moderate losses for both sides, but R1 managed to seize the critical position. Meanwhile, Blue forces reacted to the threat. B1 moved to hold the bridge approach, while B2, following orders, moved cautiously to the west flank to reinforce the line. B3 maintained its position, observing the developing battle. R2 and R3 remained static, holding their respective positions away from the immediate action.",
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
   "x": 1960,
   "y": 1680,
   "facingDeg": 10,
   "formation": "line",
   "strength": 591,
   "morale": 77,
   "fatigue": 5,
   "ammo": 88,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b1-7",
     "result": "not-arrived"
    }
   ],
   "account": "Col. Aubry had no new order; it was still on its way. He kept his line where it stood. When an enemy column came onto the bridge and its head neared the south half of the span, he opened fire by volleys at about 170 m, and the column stopped short."
  },
  {
   "unitId": "blue-2",
   "x": 2010,
   "y": 1790,
   "facingDeg": 250,
   "formation": "column",
   "strength": 546,
   "morale": 74,
   "fatigue": 6,
   "ammo": 95,
   "status": "active",
   "continuing": {
    "kind": "move",
    "x": 1960,
    "y": 1800
   },
   "orders": [
    {
     "orderId": "b2-7",
     "result": "partly"
    }
   ],
   "account": "Col. Delacroix fired a few volleys at the column on the bridge. When the order to shift west came at minute 14, he took his time breaking line, as is his way. He formed column and crossed the road behind the 1st, and is still on the move, not yet in line, as the turn ends.",
   "departure": "The order came at minute 14, with only six minutes left. The engine placed the battalion in line at (1820,1700), which is not behind the 1st Battalion at all. It has crossed the road only to (2010,1790), still in column, and will finish forming line behind the 1st, west of the road, facing the bridge next turn."
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
   "account": "Maj. Verneuil watched the enemy column come onto the bridge and itched to charge. But it never cleared the span, and he would not ride into a defile under musketry, so he held behind the infantry."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1460,
   "facingDeg": 180,
   "formation": "column",
   "strength": 622,
   "morale": 74,
   "fatigue": 24,
   "ammo": 94,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r1-7",
     "result": "partly"
    }
   ],
   "account": "Col. Brandt marched on the bridge at once and pushed his column onto the span. He seized the north end and the middle of the crossing. As the head passed the centre it came under volleys from a battalion in line on the south bank. He halted it there, his front ranks returning fire, and he holds the bridge while waiting for support to carry the far end."
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 700,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 70,
   "fatigue": 8,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Hartmann had no new orders, so he held his column in place and rested his men."
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
   "account": "Maj. von Reiter had no orders and held his squadron where it stood."
  }
 ],
 "observations": [
  {
   "side": "blue",
   "by": "blue-1",
   "unitId": "red-1",
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
   "by": "blue-3",
   "unitId": "red-1",
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
  }
 ],
 "summary": "Turn 2 (20-40). Red's Vanguard Battalion received its order to seize the bridge at minute 3. It marched down the high road and reached the north end around minute 8, then pushed onto the span. As its head passed the middle it came within musket range of Blue's 1st Battalion on the south bank and was halted by volleys. It ends holding the north end and the middle of the bridge (centre about 2050,1460), having lost 28 men to Blue's 9. Blue's 2nd Battalion fired briefly. Then its order to shift behind the 1st, west of the road, arrived at minute 14, and its cautious colonel had only begun the move: it is in column at (2010,1790) and will form line facing the bridge next turn. Blue's order for the 1st to advance to the bridge's south end is still on the road, due turn 3 minute 6, and was not acted on. Blue's cavalry held behind the line. Red's Line Battalion and hussars held without orders. The bridge is contested: Red holds the span and Blue covers the south exit."
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
   "strength": 592,
   "morale": 79,
   "fatigue": 3,
   "ammo": 85,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b1-7",
     "result": "not-arrived"
    }
   ],
   "account": "Col. Aubry holds his line south of the river as before. The head of the enemy column comes out on to the bridge and he gives it volleys at under 200 m. He gets no other order during the turn and does not leave his position."
  },
  {
   "unitId": "blue-2",
   "x": 1840,
   "y": 1740,
   "facingDeg": 40,
   "formation": "line",
   "strength": 545,
   "morale": 75,
   "fatigue": 6,
   "ammo": 92,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b2-7",
     "result": "carried-out"
    }
   ],
   "account": "Col. Delacroix stands in line beside the 1st Battalion and fires on the head of the enemy column on the bridge until his order comes at about the fourteenth minute. The column is already recoiling. He then marches his battalion behind the 1st, to the west of the road, and forms line facing the bridge, as ordered, keeping his reserve in hand."
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
   "account": "Maj. Verneuil has no order and holds behind the infantry. He sees the enemy column come on to the bridge and fall back, and wants to charge, but there is no order and no clear field."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1370,
   "facingDeg": 180,
   "formation": "column",
   "strength": 450,
   "morale": 42,
   "fatigue": 35,
   "ammo": 95,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r1-7",
     "result": "partly"
    }
   ],
   "account": "Col. Brandt receives his order at about the third minute and marches at once down the road to the north end of the bridge, then drives his column on to it to seize it. Two battalions in line on either side of the far end pour volleys into the head of the column on the bridge, where it cannot deploy. After a heavy loss he draws back to the north end, not broken but shaken, and halts there.",
   "departure": "Projection stops the column at the bridge head (2050,1380) with no casualties and no morale loss. The order is to seize the bridge; an aggressive colonel presses on to it and is shot down by the two battalions covering the far end, so the column loses about 200 men and morale falls to 42 before falling back to the same spot. The position matches; the strength and morale differ."
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
   "account": "Col. Hartmann has no new order and keeps his column where it is, by the book."
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
   "account": "Maj. von Reiter has no new order and holds his position."
  }
 ],
 "observations": [
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
   "side": "blue",
   "by": "blue-1",
   "unitId": "red-1",
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
   "by": "blue-3",
   "unitId": "red-1",
   "when": "end"
  }
 ],
 "summary": "Red-1 reached the bridge at about minute 5 and, ordered to seize it, drove its column on to it. Blue-1 and Blue-2, in line on either side of the south end, fired on it. Unable to deploy on the bridge, the column lost about 200 men and was shaken; Brandt drew it back to the north end. At minute 14 Blue-2's order to move behind the 1st Battalion, to the west of the road, and form line facing the bridge arrived, and it carried it out; the column was already falling back. Blue-1's order to advance to the south end of the bridge was still on the road and was not acted on. Blue-3, Red-2 and Red-3 had no orders and held. Blue losses were about 8 men in Blue-1 and 5 in Blue-2."
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
   "orders": [
    {
     "orderId": "b1-7",
     "result": "not-arrived"
    }
   ],
   "account": "The 1st Battalion acted as the staff tables direct."
  },
  {
   "unitId": "blue-2",
   "x": 1820,
   "y": 1700,
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
     "orderId": "b2-7",
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
   "y": 1380,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 80,
   "fatigue": 8,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "r1-7",
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
 "observations": [],
 "summary": "The turn was resolved by the tables."
}
```
