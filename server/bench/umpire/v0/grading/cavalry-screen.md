# Case cavalry-screen: Cavalry screening against cavalry reconnaissance

**What this case tests.** Red hussars screen the front of two Red columns; a Blue squadron that crossed the bridge earlier rides to find the columns. A good umpire has the screen and the scouts meet: a brush between horsemen with light losses, and whether Blue sees the columns depends on how far it gets past the screen. Observations must be ones the engine sight test allows (800 m for cavalry in the open).

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
   "x": 2350,
   "y": 1300,
   "facingDeg": 315,
   "formation": "line",
   "strength": 200,
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
   "x": 1900,
   "y": 650,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 80,
   "fatigue": 10,
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
   "x": 2150,
   "y": 550,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 70,
   "fatigue": 10,
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
   "x": 2050,
   "y": 1000,
   "facingDeg": 180,
   "formation": "loose",
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
   "orderId": "r3-6",
   "side": "red",
   "to": "red-3",
   "text": "Screen the front of the army. Keep the enemy cavalry from getting a sight of our columns. Do not get drawn into a fight beyond the screen.",
   "courier": "safe",
   "sentTurn": 2,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 1
  },
  {
   "orderId": "b3-6",
   "side": "blue",
   "to": "blue-3",
   "text": "Reconnoitre north toward the northern wood and find out what columns are behind their cavalry. Do not get caught; bring back the news.",
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
    "x": 2100,
    "y": 750,
    "facingDeg": 315,
    "formation": "line",
    "strength": 200,
    "morale": 85,
    "fatigue": 3,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "idle"
    }
   },
   {
    "unitId": "red-1",
    "x": 1900,
    "y": 650,
    "facingDeg": 180,
    "formation": "column",
    "strength": 650,
    "morale": 80,
    "fatigue": 2,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    }
   },
   {
    "unitId": "red-2",
    "x": 2150,
    "y": 550,
    "facingDeg": 180,
    "formation": "column",
    "strength": 650,
    "morale": 70,
    "fatigue": 2,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    }
   },
   {
    "unitId": "red-3",
    "x": 2050,
    "y": 1000,
    "facingDeg": 180,
    "formation": "loose",
    "strength": 220,
    "morale": 85,
    "fatigue": 2,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    }
   }
  ],
  "events": [
   "minute 1: unit.arrived {\"unitId\":\"red-3\",\"at\":[2050,1000]}",
   "minute 5: unit.arrived {\"unitId\":\"blue-3\",\"at\":[2100,750]}"
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
   "account": "Col. Aubry had no new orders and held his line south of the bridge."
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
   "account": "Col. Delacroix had no new orders and held his line east of the road."
  },
  {
   "unitId": "blue-3",
   "x": 2150,
   "y": 1330,
   "facingDeg": 200,
   "formation": "line",
   "strength": 195,
   "morale": 84,
   "fatigue": 22,
   "ammo": 94,
   "status": "active",
   "continuing": {
    "kind": "move",
    "x": 2050,
    "y": 1800
   },
   "orders": [
    {
     "orderId": "b3-6",
     "result": "carried-out"
    }
   ],
   "account": "Maj. Verneuil pushed north-west towards the northern wood. The enemy hussars at once closed across his path in a loose screen and traded carbine shots. Over their heads he made out two battalion columns on and west of the high road, about 600-800 m beyond. Tempted to charge, he remembered he was not to get caught. He broke off and rode back towards the bridge with the news, losing a few men.",
   "departure": "The engine sent the squadron straight past the enemy hussar screen to (2100,750), between two enemy battalions. The hussars, ordered to screen, barred the way. Since the columns were already in sight, the squadron probed, skirmished and turned back towards the bridge as told not to get caught."
  },
  {
   "unitId": "red-1",
   "x": 1900,
   "y": 650,
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
   "orders": [],
   "account": "Col. Brandt had no orders, so he held his column and rested his men, chafing at the delay."
  },
  {
   "unitId": "red-2",
   "x": 2150,
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
   "account": "Col. Hartmann had no orders, so he held his column in place and waited."
  },
  {
   "unitId": "red-3",
   "x": 2200,
   "y": 1080,
   "facingDeg": 135,
   "formation": "loose",
   "strength": 216,
   "morale": 85,
   "fatigue": 18,
   "ammo": 95,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r3-6",
     "result": "partly"
    }
   ],
   "account": "Maj. von Reiter shook out his hussars across the front and shifted east to bar the enemy squadron's way north. He traded carbine shots with it and saw it turn back. Remembering his orders, he did not chase it towards the bridge but kept the screen in place. The enemy horse had already had sight of the columns, though, before he could close the gap.",
   "departure": "The hussars moved about 170 m east of the projected spot to place the screen across the enemy squadron's line of advance, as the screening order requires."
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
   "by": "red-3",
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
  }
 ],
 "summary": "Turn 2 (20-40). Blue's cavalry squadron, already north of the river at (2350,1300), received its reconnaissance order at minute 3 and rode north-west towards the northern wood. Red's hussars had been screening from minute 1. They moved east in loose order to bar the way, and the two squadrons skirmished with carbines at about 100 m around minute 8-12: Blue lost 5 men, Red 4. The hussars could not hide the two Red battalion columns, around (1900,650) and (2150,550), which were within the Blue squadron's sight from the start. Blue therefore has its news. Mindful not to be caught, the Blue squadron broke off and rode back towards the bridge. It ends at (2150,1330) heading to cross and report. The hussars held the screen at (2200,1080) and did not pursue, as ordered. Both Red battalions and both Blue battalions held without orders. The engine's projection sent the Blue squadron unopposed into the middle of the Red columns; that was rejected."
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
   "account": "Col. Aubry has no new order and holds his line south of the river, facing the bridge. Nothing comes within sight."
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
   "account": "Col. Delacroix has no new order and keeps his line beside the 1st Battalion. Nothing comes within sight."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1800,
   "facingDeg": 0,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "fatigue": 28,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b3-6",
     "result": "carried-out"
    }
   ],
   "account": "Maj. Verneuil gets his order a little after the third minute. From where he stands he can already see two columns on the road to the north, with a screen of horse in front of them. He rides west round the end of the screen to the open ground below the northern wood, sees the head of a column at about 600 m, and turns back before the enemy horse can cut him off. He re-crosses the river by the bridge and reports to the infantry.",
   "departure": "Projection has the squadron ride 600 m north to (2100,750), straight at the enemy columns and in the face of their screen, and stay there idle. Verneuil's order is to reconnoitre towards the northern wood, not get caught, and bring back the news, so he skirts the screen to the west, looks, and returns to the south bank, ending 1 km from the projected position and more tired."
  },
  {
   "unitId": "red-1",
   "x": 1900,
   "y": 650,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 80,
   "fatigue": 2,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Brandt has no new order and keeps his column where it is. He glimpses horse far off to the west but his own screen is between him and it."
  },
  {
   "unitId": "red-2",
   "x": 2150,
   "y": 550,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 70,
   "fatigue": 2,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Hartmann has no new order and halts his column where he is, by the book."
  },
  {
   "unitId": "red-3",
   "x": 1750,
   "y": 950,
   "facingDeg": 250,
   "formation": "loose",
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
     "orderId": "r3-6",
     "result": "carried-out"
    }
   ],
   "account": "Maj. von Reiter shifts his screen west and south to keep himself between the enemy horse and the columns when he sees it ride out to the west. He does not charge: his order is to screen and not to be drawn on. The enemy gets a sight of the head of one column, but no more, and then goes back.",
   "departure": "Projection keeps the hussars at (2050,1000) holding. The enemy horse moves round the screen's flank, so von Reiter moves 300 m to the west to stay between it and the columns, which is more than the 100 m tolerance."
  }
 ],
 "observations": [
  {
   "side": "blue",
   "by": "blue-3",
   "unitId": "red-3",
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
   "by": "red-3",
   "unitId": "blue-3",
   "when": "start"
  }
 ],
 "summary": "A quiet turn of manoeuvre. Blue-3, on the north bank east of the road, saw both Red columns and the hussar screen at the start of the turn. On its order to reconnoitre towards the northern wood he rode west round the end of the screen, got a sight of the head of a column at about 600 m, and withdrew over the bridge to Blue's lines. Red-3 shifted west to keep itself between him and the columns but did not charge, in keeping with its orders to screen and not to be drawn on. No fire or melee. The infantry on both sides held. The projection's idle advance of the Blue cavalry into the Red screen was replaced by the withdrawal."
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
   "x": 2100,
   "y": 750,
   "facingDeg": 315,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "fatigue": 3,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "b3-6",
     "result": "carried-out"
    }
   ],
   "account": "The Cavalry Squadron acted as the staff tables direct."
  },
  {
   "unitId": "red-1",
   "x": 1900,
   "y": 650,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 80,
   "fatigue": 2,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "The Vanguard Battalion acted as the staff tables direct."
  },
  {
   "unitId": "red-2",
   "x": 2150,
   "y": 550,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 70,
   "fatigue": 2,
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
   "x": 2050,
   "y": 1000,
   "facingDeg": 180,
   "formation": "loose",
   "strength": 220,
   "morale": 85,
   "fatigue": 2,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r3-6",
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
