# Case uncontested-march: An uncontested march down the high road

**What this case tests.** Red marches south on the road with no enemy within reach. A good umpire moves the columns about as far as the projection, keeps losses at zero, and has Blue (with no new orders) stay put. Nobody sees anybody across 1 km of open ground beyond sight range.

## The umpire's input

```json
{
 "turn": 1,
 "startMinute": 0,
 "endMinute": 20,
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
   "y": 300,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 80,
   "fatigue": 0,
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
   "y": 120,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 70,
   "fatigue": 0,
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
   "orderId": "r1-1",
   "side": "red",
   "to": "red-1",
   "text": "March south down the high road in column and halt 400 paces short of the river.",
   "courier": "safe",
   "sentTurn": 1,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 2
  },
  {
   "orderId": "r2-1",
   "side": "red",
   "to": "red-2",
   "text": "Follow the Vanguard down the road at three hundred paces.",
   "courier": "safe",
   "sentTurn": 1,
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
    "y": 1100,
    "facingDeg": 180,
    "formation": "column",
    "strength": 650,
    "morale": 80,
    "fatigue": 0,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "idle"
    }
   },
   {
    "unitId": "red-2",
    "x": 2050,
    "y": 850,
    "facingDeg": 180,
    "formation": "column",
    "strength": 650,
    "morale": 70,
    "fatigue": 0,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "idle"
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
   "minute 5: unit.arrived {\"unitId\":\"red-1\",\"at\":[2050,1100]}",
   "minute 6: unit.arrived {\"unitId\":\"red-2\",\"at\":[2050,850]}"
  ]
 }
}
```

## Proposal A

```json
{
 "turn": 1,
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
   "account": "Col. Aubry holds his position, maintaining the line as ordered."
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
   "account": "Col. Delacroix is cautious and holds his position as instructed."
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
     "orderId": "b3-1",
     "result": "carried-out"
    }
   ],
   "account": "Maj. Verneuil, bold and impatient, holds his position as ordered."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1100,
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
     "orderId": "r1-1",
     "result": "carried-out"
    }
   ],
   "account": "Col. Brandt marches his Vanguard down the high road and halts as ordered."
  },
  {
   "unitId": "red-2",
   "x": 2050,
   "y": 850,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 70,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "r2-1",
     "result": "carried-out"
    }
   ],
   "account": "Col. Hartmann follows the Vanguard as ordered."
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
     "orderId": "r3-1",
     "result": "not-arrived"
    }
   ],
   "account": "Maj. von Reiter, dashing scout, is still on the road and has not arrived at his position."
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
 "summary": "In the first turn, the red vanguard marched down the high road and halted 400 paces short of the river, while the red line battalion followed. The blue line infantry held their positions. The hussar squadron, however, was still on the road and had not arrived at its position. The projected positions and statuses of the units were largely accurate, with minor discrepancies noted."
}
```

## Proposal B

```json
{
 "turn": 1,
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
   "account": "Colonel Aubry held his line steady, awaiting further orders.",
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
   "account": "Colonel Delacroix remained cautious, waiting for the enemy to make the first move.",
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
   "account": "Major Verneuil held his cavalry in reserve, awaiting an opportunity to strike.",
   "departure": ""
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1400,
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
     "orderId": "r1-1",
     "result": "carried-out"
    }
   ],
   "account": "Colonel Brandt marched his battalion down the high road, halting 400 paces short of the river.",
   "departure": ""
  },
  {
   "unitId": "red-2",
   "x": 2050,
   "y": 900,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 70,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "r2-1",
     "result": "carried-out"
    }
   ],
   "account": "Colonel Hartmann followed the Vanguard down the road, keeping a safe distance.",
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
    "kind": "hold"
   },
   "orders": [],
   "account": "Major von Reiter held his cavalry in reserve, awaiting an opportunity to strike.",
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
 "summary": "The Blue forces held their positions, awaiting further orders. The Red forces marched down the high road, with the Vanguard Battalion halting 400 paces short of the river. The Hussar Squadron remained in reserve, awaiting an opportunity to strike."
}
```

## Proposal C

```json
{
 "turn": 1,
 "units": [
  {
   "unitId": "blue-1",
   "x": 1960,
   "y": 1680,
   "facingDeg": 0,
   "formation": "line",
   "strength": 580,
   "morale": 80,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Aubry maintained the defensive line, holding his position steadfastly. The arrival of the enemy cavalry squadron forced a skirmish, but the battalion held firm against the charge, sustaining minor casualties.",
   "departure": "Minor losses sustained due to engagement with Red-3."
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
   "account": "Col. Delacroix maintained his defensive posture, remaining cautious and refusing to commit his reserve forces despite the enemy's advance.",
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
   "account": "Maj. Verneuil held his position, maintaining observation of the enemy's movements along the high road, awaiting a suitable opportunity to engage.",
   "departure": ""
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1900,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 80,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r1-1",
     "result": "carried-out"
    }
   ],
   "account": "Col. Brandt, being aggressive, executed the order immediately. He marched his vanguard down the high road until he halted 400 paces short of the river, establishing a forward position.",
   "departure": ""
  },
  {
   "unitId": "red-2",
   "x": 2050,
   "y": 2200,
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
   "account": "Col. Hartmann, adhering strictly to orders, followed the Vanguard, maintaining the specified distance down the high road. He established a strong position further south.",
   "departure": ""
  },
  {
   "unitId": "red-3",
   "x": 2050,
   "y": 1500,
   "facingDeg": 0,
   "formation": "line",
   "strength": 130,
   "morale": 75,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Maj. von Reiter, driven by his aggressive nature and desire to strike early, moved rapidly towards the center of the enemy line. Upon reaching the vicinity of the objective, he initiated a charge against the nearest infantry battalion, suffering heavy losses in the engagement.",
   "departure": "Significant losses sustained during the charge against Blue-1."
  }
 ],
 "observations": [
  {
   "side": "red",
   "unitId": "red-3",
   "by": "red-3",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "red-1",
   "by": "red-3",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "red-2",
   "by": "red-3",
   "when": "end"
  },
  {
   "side": "blue",
   "unitId": "blue-1",
   "by": "blue-3",
   "when": "end"
  },
  {
   "side": "blue",
   "unitId": "blue-2",
   "by": "blue-3",
   "when": "end"
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
   "by": "blue-1",
   "when": "end"
  },
  {
   "side": "blue",
   "unitId": "red-3",
   "by": "blue-1",
   "when": "end"
  }
 ],
 "summary": "The Red forces initiated a rapid advance along the high road. Red-1 (Vanguard) and Red-2 (Line) successfully marched south, establishing strong positions near the objective area. Red-3 (Hussars), driven by aggressive initiative, moved quickly towards the Blue defensive line. Upon arrival, Red-3 engaged Blue-1, initiating a cavalry charge against the infantry. Although the charge inflicted casualties on the Blue battalion, the disciplined defense held the line. The Blue units maintained their defensive positions, observing the Red advance. The Red forces have successfully positioned themselves to threaten the objective, but the Blue line remains intact.",
 "rolls": []
}
```

## Proposal D

```json
{
 "turn": 1,
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
   "account": "Col. Aubry had no orders and held his line south of the bridge. Late in the turn he saw an enemy column halt on the high road beyond the river."
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
   "account": "Col. Delacroix had no orders and held his line, watching an enemy column come down the road on the far bank and halt."
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
   "account": "Maj. Verneuil had no orders and held his squadron behind the infantry, watching the enemy column on the far side of the river."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1100,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 80,
   "fatigue": 5,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r1-1",
     "result": "carried-out"
    }
   ],
   "account": "Col. Brandt marched his column down the high road the moment the order came. He halted it as ordered 400 paces (about 300 m) short of the river bank. From there he could see enemy infantry in line beyond the bridge."
  },
  {
   "unitId": "red-2",
   "x": 2050,
   "y": 875,
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
   "orders": [
    {
     "orderId": "r2-1",
     "result": "carried-out"
    }
   ],
   "account": "Col. Hartmann followed the Vanguard down the road in column, keeping his interval of 300 paces, and halted when it halted."
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
   "account": "Maj. von Reiter had no orders and held his squadron west of the road."
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
  }
 ],
 "summary": "Turn 1 (0-20). An uncontested march. Red's Vanguard Battalion received its order at minute 2 and marched about 800 m down the high road in column. It halted 400 paces (about 300 m) short of the river at (2050,1100). Red's Line Battalion received its order at minute 3 and followed at 300 paces, halting at (2050,875). At the end of the turn the Vanguard and the two Blue battalions south of the bridge can see each other at under 600 m, and the Blue cavalry also has it in view. Nobody was in range to fire. All other units held without orders. There were no losses."
}
```

## Proposal E

```json
{
 "turn": 1,
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
   "account": "Col. Aubry has no order and holds his line south of the river, facing the bridge. Towards the end of the turn he sights an enemy column halted on the road some 590 m to the north and keeps his men quiet."
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
   "account": "Col. Delacroix has no order and keeps his line beside the 1st Battalion. He sights an enemy column on the road to the north, halted, and waits to see what it does."
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
   "account": "Maj. Verneuil has no order and stays behind the infantry. He sights an enemy column on the road, a kilometre away at most, and reports it, but does not move without orders."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1100,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 80,
   "fatigue": 5,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r1-1",
     "result": "carried-out"
    }
   ],
   "account": "Col. Brandt gets his order at about the second minute and marches his battalion south down the high road in column. He halts at about the fifth minute, 400 paces (about 300 m) short of the river, as he was told. He sees the enemy line beyond the river at about 590 m and holds there, eager to go on."
  },
  {
   "unitId": "red-2",
   "x": 2050,
   "y": 860,
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
   "orders": [
    {
     "orderId": "r2-1",
     "result": "carried-out"
    }
   ],
   "account": "Col. Hartmann gets his order at about the third minute and follows the Vanguard down the road, by the book, keeping 300 paces (about 225 m) behind it. When the Vanguard halts he halts behind it, and waits for orders."
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
   "account": "Maj. von Reiter has no order and holds his position at the edge of the northern wood."
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
  }
 ],
 "summary": "A quiet turn. Red-1 marched down the high road in column and halted 400 paces (about 300 m) short of the river at about (2050,1100), as ordered, and Red-2 followed 300 paces behind and halted at about (2050,860). No contact: the Blue infantry in line south of the river were about 590 m from the Red head of column, which is out of musket range, and no shots were fired. By the end of the turn the Blue infantry and cavalry had sighted the Red column on the road, and Red-1 had sighted the Blue infantry. Blue and Red-3 held. This matches the projection."
}
```

## Proposal F

```json
{
 "turn": 1,
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
   "y": 1100,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 80,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "r1-1",
     "result": "carried-out"
    }
   ],
   "account": "The Vanguard Battalion acted as the staff tables direct."
  },
  {
   "unitId": "red-2",
   "x": 2050,
   "y": 850,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 70,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "r2-1",
     "result": "carried-out"
    }
   ],
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
