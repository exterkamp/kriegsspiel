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
   "orderId": "red-r3-6",
   "side": "red",
   "to": "red-3",
   "text": "Screen the front of the army. Keep the enemy cavalry from getting a sight of our columns. Do not get drawn into a fight beyond the screen.",
   "courier": "safe",
   "sentAtMinute": 20,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 1
  },
  {
   "orderId": "blue-b3-6",
   "side": "blue",
   "to": "blue-3",
   "text": "Reconnoitre north toward the northern wood and find out what columns are behind their cavalry. Do not get caught; bring back the news.",
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
    "at": "near the bridge, east of the High road"
   },
   {
    "unitId": "blue-3",
    "x": 2350,
    "y": 1300,
    "facingDeg": 315,
    "formation": "line",
    "strength": 200,
    "morale": 85,
    "fatigue": 2,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    },
    "at": "near the bridge, north of the river"
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
    "at": "west of the High road"
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
    "at": "east of the High road"
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
    "at": "near the bridge, on the High road"
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
    "unitId": "blue-2",
    "by": "red-3",
    "when": "start"
   },
   {
    "side": "red",
    "unitId": "blue-3",
    "by": "red-3",
    "when": "start"
   },
   {
    "side": "blue",
    "unitId": "red-1",
    "by": "blue-3",
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
    "by": "red-3",
    "when": "end"
   },
   {
    "side": "red",
    "unitId": "blue-2",
    "by": "red-3",
    "when": "end"
   },
   {
    "side": "red",
    "unitId": "blue-3",
    "by": "red-3",
    "when": "end"
   }
  ],
  "events": [
   "21: order_delivered red-3, orderId red-r3-6",
   "23: order_delivered blue-3, orderId blue-b3-6"
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
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "No new orders. The battalion held its line west of the road facing north and watched the bridge."
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
   "account": "No new orders. Col. Delacroix kept his battalion in place east of the road and committed nothing."
  },
  {
   "unitId": "blue-3",
   "x": 2450,
   "y": 850,
   "facingDeg": 340,
   "formation": "column",
   "strength": 200,
   "morale": 85,
   "fatigue": 12,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "blue-b3-6",
     "result": "carried-out"
    }
   ],
   "account": "The order reached me a few minutes into the turn. I rode north along the east side, clear of the road, until I could see the enemy columns and their hussars. Their cavalry came across to cut me off, so I halted short of them. I will not be drawn in, and I can now report two battalions of foot in column near the road, about 600 m north of the river.",
   "departure": "The projection left him standing. His reconnaissance order arrived in minute 3 and he is aggressive with initiative, so he moves about 480 m north-north-east as ordered."
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
   "account": "No orders. Col. Brandt stayed in column west of the road and watched the hussars move out in front."
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
   "account": "No orders. Col. Hartmann waited in column east of the road."
  },
  {
   "unitId": "red-3",
   "x": 2300,
   "y": 880,
   "facingDeg": 120,
   "formation": "loose",
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
     "orderId": "red-r3-6",
     "result": "carried-out"
    }
   ],
   "account": "I saw enemy cavalry coming up on our eastern flank. I moved across to put my hussars between them and our columns, as ordered. I stopped at the edge of the screen and did not charge.",
   "departure": "The projection left him on the road. Ordered to screen the army against enemy cavalry, he shifts about 280 m east-south-east to cover the columns from the approaching squadron."
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
   "unitId": "blue-2",
   "by": "red-3",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-3",
   "by": "red-3",
   "when": "start"
  },
  {
   "side": "blue",
   "unitId": "red-1",
   "by": "blue-3",
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
   "unitId": "blue-3",
   "by": "red-3",
   "when": "end"
  }
 ],
 "summary": "Quiet turn. Blue-3 rode north-north-east to (2450,850) on his reconnaissance order and saw both Red battalions and the hussars. Red-3 moved east to (2300,880) to screen, with no charge and no contact. Infantry on both sides held. Blue-3 is now about 400 m from Red's hussars and may be drawn into a fight next turn. Red infantry are still unordered and in column near y 550-650."
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
   "account": "Col. Aubry had no new order and held his line south of the bridge, west of the road, facing north. Nothing came within musket range."
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
   "account": "Col. Delacroix had no new order and held his line east of the road, south of the bridge. He watched the far bank and stayed where he was."
  },
  {
   "unitId": "blue-3",
   "x": 1550,
   "y": 1050,
   "facingDeg": 330,
   "formation": "loose",
   "strength": 197,
   "morale": 84,
   "fatigue": 15,
   "ammo": 98,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "blue-b3-6",
     "result": "carried-out"
    }
   ],
   "account": "Maj. Verneuil read the order at once and went. He opened out his troopers and swung north-west past the enemy hussars, toward the eastern edge of the northern wood. He got a clear look at two infantry columns, one west and one east of the high road, about 600 to 800 m north of the bridge. The hussars came across to bar him and there was some carbine work at long range between the vedettes; he lost a few men. He has halted short of the wood to send the news back, and has not committed himself."
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
   "account": "Col. Brandt had no new order and held his column west of the high road. Late in the turn he saw enemy horsemen working round toward the wood, about 500 m off his right front."
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
   "account": "Col. Hartmann had no new order and waited in column east of the high road, as the regulations require."
  },
  {
   "unitId": "red-3",
   "x": 1800,
   "y": 1000,
   "facingDeg": 240,
   "formation": "loose",
   "strength": 218,
   "morale": 85,
   "fatigue": 10,
   "ammo": 98,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "red-r3-6",
     "result": "partly"
    }
   ],
   "account": "Maj. von Reiter took the screening order early in the turn. When the enemy squadron slipped round his west flank toward the wood, he shifted his troopers west to put them between it and our columns. He came across too late to stop it seeing them. He kept to the order and did not close: his vedettes traded carbine shots at long range and lost two men. He now stands west of the high road with the enemy horse in front of him."
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
   "unitId": "blue-2",
   "by": "red-3",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-3",
   "by": "red-3",
   "when": "start"
  },
  {
   "side": "blue",
   "unitId": "red-1",
   "by": "blue-3",
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
   "by": "red-3",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "blue-2",
   "by": "red-3",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "blue-3",
   "by": "red-3",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "blue-3",
   "by": "red-1",
   "when": "end"
  }
 ],
 "summary": "Blue cavalry (blue-3) reconnoitred north-west round the Red hussar screen to (1550,1050), short of the northern wood. It confirmed both Red columns north of the bridge and now holds there to report. Red hussars (red-3) shifted west to (1800,1000) to interpose but came too late to deny the sighting; the order was partly carried out. The vedettes skirmished at long range with trivial losses (blue-3 -3, red-3 -2), and neither commander closed, as his orders forbade. All four infantry battalions held in place with no orders. Departures from the static projection: both cavalry units moved under orders that had arrived, and the projection had ignored those orders.",
 "precedents": [
  "Cavalry under orders not to engage may exchange long-range carbine fire at vedette distance with trivial losses, but neither side closes."
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
   "x": 2350,
   "y": 1300,
   "facingDeg": 315,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "fatigue": 2,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "blue-b3-6",
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
     "orderId": "red-r3-6",
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
   "unitId": "blue-2",
   "by": "red-3",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-3",
   "by": "red-3",
   "when": "start"
  },
  {
   "side": "blue",
   "unitId": "red-1",
   "by": "blue-3",
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
   "by": "red-3",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "blue-2",
   "by": "red-3",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "blue-3",
   "by": "red-3",
   "when": "end"
  }
 ],
 "summary": "The turn was resolved by the tables."
}
```
