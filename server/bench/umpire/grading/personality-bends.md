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
   "orderId": "blue-b3-11",
   "side": "blue",
   "to": "blue-3",
   "text": "Hold your squadron in reserve behind the 1st Battalion. Do not engage unless I order it.",
   "courier": "safe",
   "sentAtMinute": 20,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 1
  },
  {
   "orderId": "blue-b2-11",
   "side": "blue",
   "to": "blue-2",
   "text": "Advance at once to the south end of the bridge and close it to the enemy column.",
   "courier": "fast",
   "sentAtMinute": 20,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 2
  },
  {
   "orderId": "red-r1-11",
   "side": "red",
   "to": "red-1",
   "text": "Push across the bridge and form on the south bank.",
   "courier": "fast",
   "sentAtMinute": 20,
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
    "facingDeg": 30,
    "formation": "line",
    "strength": 600,
    "morale": 80,
    "fatigue": 2,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    },
    "at": "near the bridge, south of the river"
   },
   {
    "unitId": "blue-2",
    "x": 2250,
    "y": 1850,
    "facingDeg": 0,
    "formation": "column",
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
    "x": 2050,
    "y": 1950,
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
    "y": 1450,
    "facingDeg": 180,
    "formation": "column",
    "strength": 650,
    "morale": 70,
    "fatigue": 22,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    },
    "at": "at the bridge, on the High road"
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
    "at": "near the bridge, north of the river"
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
    "by": "blue-1",
    "when": "start"
   },
   {
    "side": "blue",
    "unitId": "red-2",
    "by": "blue-1",
    "when": "start"
   },
   {
    "side": "red",
    "unitId": "blue-1",
    "by": "red-1",
    "when": "start"
   },
   {
    "side": "red",
    "unitId": "blue-2",
    "by": "red-1",
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
    "by": "blue-1",
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
   "21: order_delivered blue-3, orderId blue-b3-11",
   "21: order_delivered red-1, orderId red-r1-11",
   "22: order_delivered blue-2, orderId blue-b2-11"
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
   "x": 1900,
   "y": 1700,
   "facingDeg": 30,
   "formation": "line",
   "strength": 580,
   "morale": 78,
   "fatigue": 4,
   "ammo": 92,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Aubry held his line as laid down. When the enemy column came off the bridge onto the south bank he gave volleys at under 200 paces and kept his ranks closed. He did not advance."
  },
  {
   "unitId": "blue-2",
   "x": 2100,
   "y": 1690,
   "facingDeg": 0,
   "formation": "line",
   "strength": 535,
   "morale": 73,
   "fatigue": 4,
   "ammo": 95,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "blue-b2-11",
     "result": "partly"
    }
   ],
   "account": "The order reached Col. Delacroix at the second minute. He moved up at once, but found the enemy already coming off the south end of the bridge. He would not run his column into them and deployed to line about 70 paces short, in support of the 1st Battalion. The bridge end was not closed; it is held under fire only.",
   "departure": "Projection had him idle. The order arrived at minute 2 and he advanced about 170 m. Cautious by nature, he stopped short of the bridge end because the enemy was already across."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1950,
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
   "orders": [
    {
     "orderId": "blue-b3-11",
     "result": "carried-out"
    }
   ],
   "account": "Maj. Verneuil kept to his orders and stayed in reserve on the High road. He chafed at it, but no order came to release him."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1625,
   "facingDeg": 180,
   "formation": "line",
   "strength": 600,
   "morale": 65,
   "fatigue": 28,
   "ammo": 95,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "red-r1-11",
     "result": "carried-out"
    }
   ],
   "account": "Col. Brandt took the bridge at once in column and crossed under fire. He deployed to line on the south bank, facing the enemy, and returned fire. He took casualties while crossing and deploying, but holds the south end of the bridge.",
   "departure": "Projection had him idle at the north end. The order arrived at minute 1 and the crossing is about 175 m. An aggressive commander would make it in the turn. The fire of two battalions on the bridge exit costs him about 50 men, more than 5% of his strength."
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
   "account": "Col. Hartmann had no orders and waited in place by the book, watching the vanguard cross."
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
   "account": "Maj. von Reiter had no orders and stood by near the Northern wood."
  }
 ],
 "observations": [
  {
   "side": "blue",
   "unitId": "red-1",
   "by": "blue-1",
   "when": "start"
  },
  {
   "side": "blue",
   "unitId": "red-2",
   "by": "blue-1",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-1",
   "by": "red-1",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-2",
   "by": "red-1",
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
   "unitId": "red-1",
   "by": "blue-2",
   "when": "end"
  },
  {
   "side": "blue",
   "unitId": "red-2",
   "by": "blue-2",
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
  },
  {
   "side": "red",
   "unitId": "blue-2",
   "by": "red-2",
   "when": "end"
  }
 ],
 "summary": "Red-1 crossed the bridge in column and deployed to line on the south bank at about (2050,1625). Blue-1 fired on it from 170 m. Blue-2 came up and deployed to line at (2100,1690), short of the bridge end, so the bridge is not closed. Red-1 lost about 50 men and blue-1 about 20, blue-2 about 15. Blue-3 holds in reserve under orders. Red-2 and red-3 had no orders and stayed put. Next turn expect a close fight at the bridge head. Red-1 is isolated south of the river unless red-2 is ordered forward.",
 "precedents": [
  "Orders to a unit already in contact are carried out only as far as the enemy allows; a cautious commander deploys short rather than march a column into the enemy."
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
   "x": 1900,
   "y": 1700,
   "facingDeg": 30,
   "formation": "line",
   "strength": 585,
   "morale": 79,
   "fatigue": 14,
   "ammo": 80,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Aubry held his ground as ordered. When the enemy column came off the bridge some 180 paces to his right front he opened by companies on its flank and kept up a steady fire until it fell back onto the bridge. He did not advance, having no order to do so. A few men were hit by return fire.",
   "departure": "The enemy column came off the bridge within his range, so he fired on it; small losses and ammunition spent, which the projection omitted because it had no one moving."
  },
  {
   "unitId": "blue-2",
   "x": 2050,
   "y": 1630,
   "facingDeg": 0,
   "formation": "line",
   "strength": 505,
   "morale": 69,
   "fatigue": 15,
   "ammo": 88,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "blue-b2-11",
     "result": "carried-out"
    }
   ],
   "account": "Col. Delacroix had the order at minute 2. He lost a few minutes dressing his column and then marched on the bridge. He found the enemy head already across, deployed across the road at the south end and fired into it. After two volleys he closed with the bayonet. The column gave way to the bridge. He halted at the bank and did not follow across, which his order did not require. He now holds the south end.",
   "departure": "The order arrived at minute 2 and the projection left him standing. He marched about 300 m to the south end of the bridge and fought there; he took losses accordingly."
  },
  {
   "unitId": "blue-3",
   "x": 1850,
   "y": 1900,
   "facingDeg": 30,
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
     "orderId": "blue-b3-11",
     "result": "carried-out"
    }
   ],
   "account": "Maj. Verneuil took the squadron back behind the 1st Battalion as ordered and stood there in reserve. He watched the fight at the bridge and found it hard to keep still. He did not charge, having no order to do so.",
   "departure": "He moved about 200 m to the reserve post behind the 1st Battalion named in his order; the projection did not move him."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1480,
   "facingDeg": 180,
   "formation": "column",
   "strength": 530,
   "morale": 48,
   "fatigue": 38,
   "ammo": 85,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "red-r1-11",
     "result": "partly"
    }
   ],
   "account": "Col. Brandt pushed his column over the bridge at once. Its head reached the south bank and began to deploy, but it came under fire from a line on its right and a fresh battalion closing from the front. The leading companies were broken up with the bayonet and the column was driven back onto the bridge. He rallied it at the north end, where it still holds the bridge. Losses are heavy.",
   "departure": "Pressed across the bridge as ordered. He could not deploy a column debouching from a defile under fire from two sides, was thrown back with about 120 men lost, and his morale fell. The projection had him idle."
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 1250,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 68,
   "fatigue": 17,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Hartmann held his position north of the river and waited for orders. He watched the vanguard go over the bridge and come back. The fight was out of his range and he did not move without an order."
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
   "account": "Maj. von Reiter held his squadron by the northern wood as before. He had no new orders and nothing within his sight to act on."
  }
 ],
 "observations": [
  {
   "side": "blue",
   "unitId": "red-1",
   "by": "blue-1",
   "when": "start"
  },
  {
   "side": "blue",
   "unitId": "red-2",
   "by": "blue-1",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-1",
   "by": "red-1",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-2",
   "by": "red-1",
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
   "unitId": "red-2",
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
   "side": "blue",
   "unitId": "red-2",
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
  },
  {
   "side": "red",
   "unitId": "blue-1",
   "by": "red-2",
   "when": "end"
  },
  {
   "side": "red",
   "unitId": "blue-2",
   "by": "red-2",
   "when": "end"
  }
 ],
 "summary": "Turn 2 (20-40): red-1 pushed its column over the bridge, but its head was caught deploying on the south bank. Blue-1 fired on its flank from about 180 m and blue-2 arrived, fired and closed with the bayonet. Red-1 was thrown back to the north end of the bridge (2050,1480): 120 men lost, morale 48. It still holds the bridge, and blue-2 now holds the south end in line at 2050,1630 with 505 men. Blue-1 held at 1900,1700 and fired (15 lost, ammo 80). Blue-3 went into reserve behind blue-1 at 1850,1900 as ordered and did not charge. Red-2 and red-3 stood without orders. The objective square at the bridge is contested; neither side holds the south bank crossing outright.",
 "precedents": [
  "A column debouching from the bridge under fire from formed infantry on the far bank cannot deploy and is thrown back unless supported."
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
   "x": 1900,
   "y": 1700,
   "facingDeg": 30,
   "formation": "line",
   "strength": 600,
   "morale": 80,
   "fatigue": 2,
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
   "x": 2250,
   "y": 1850,
   "facingDeg": 0,
   "formation": "column",
   "strength": 550,
   "morale": 75,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "blue-b2-11",
     "result": "carried-out"
    }
   ],
   "account": "The 2nd Battalion acted as the staff tables direct."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1950,
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
   "orders": [
    {
     "orderId": "blue-b3-11",
     "result": "carried-out"
    }
   ],
   "account": "The Cavalry Squadron acted as the staff tables direct."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1450,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 70,
   "fatigue": 22,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "red-r1-11",
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
 "observations": [
  {
   "side": "blue",
   "unitId": "red-1",
   "by": "blue-1",
   "when": "start"
  },
  {
   "side": "blue",
   "unitId": "red-2",
   "by": "blue-1",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-1",
   "by": "red-1",
   "when": "start"
  },
  {
   "side": "red",
   "unitId": "blue-2",
   "by": "red-1",
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
   "by": "blue-1",
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
