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
   "orderId": "red-r1-3",
   "side": "red",
   "to": "red-1",
   "text": "Storm the bridge at the double in column. Do not fire; use the bayonet. Take the far end and hold it.",
   "courier": "fast",
   "sentAtMinute": 20,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 2
  },
  {
   "orderId": "red-r2-3",
   "side": "red",
   "to": "red-2",
   "text": "Line the river bank and fire on the enemy battalions covering the bridge.",
   "courier": "fast",
   "sentAtMinute": 20,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 3
  },
  {
   "orderId": "blue-b1-3",
   "side": "blue",
   "to": "blue-1",
   "text": "Hold the bridge at all costs. Fire by volleys on anything that sets foot on it.",
   "courier": "safe",
   "sentAtMinute": 20,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 1
  },
  {
   "orderId": "blue-b2-3",
   "side": "blue",
   "to": "blue-2",
   "text": "Hold your line beside the 1st and give fire on the bridge.",
   "courier": "safe",
   "sentAtMinute": 20,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 1
  }
 ],
 "projection": {
  "units": [
   {
    "unitId": "blue-1",
    "x": 2050,
    "y": 1500,
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
    "at": "at the bridge, on the High road",
    "path": [
     [
      1980,
      1660
     ],
     [
      2050,
      1500
     ]
    ]
   },
   {
    "unitId": "blue-2",
    "x": 2120,
    "y": 1660,
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
    "y": 1290,
    "facingDeg": 180,
    "formation": "column",
    "strength": 650,
    "morale": 80,
    "fatigue": 17,
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
    "y": 1300,
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
    "at": "near the bridge, north of the river"
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
    "at": "near the bridge, north of the river"
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
    "side": "blue",
    "unitId": "red-3",
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
    "unitId": "red-3",
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
   "21: order_delivered blue-1, orderId blue-b1-3",
   "21: order_delivered blue-2, orderId blue-b2-3",
   "22: order_delivered red-1, orderId red-r1-3",
   "23: unit.arrived blue-1",
   "23: order_delivered red-2, orderId red-r2-3"
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
   "x": 2050,
   "y": 1620,
   "facingDeg": 0,
   "formation": "line",
   "strength": 560,
   "morale": 72,
   "fatigue": 8,
   "ammo": 78,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "blue-b1-3",
     "result": "carried-out"
    }
   ],
   "account": "Col. Aubry closed on the bridge and drew up in line at the south bank, covering the span. He gave volleys as the column came on and met it at the bridge-end with the bayonet. The first rush was thrown back. He keeps his ground.",
   "departure": "The projection puts the battalion on the bridge itself. A line cannot form on a 200 m span, so Aubry deploys at the south bank, 120 m from the projected point. The column is fired on and repulsed there, so there are losses the projection does not have."
  },
  {
   "unitId": "blue-2",
   "x": 2120,
   "y": 1640,
   "facingDeg": 0,
   "formation": "line",
   "strength": 540,
   "morale": 73,
   "fatigue": 6,
   "ammo": 86,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "blue-b2-3",
     "result": "carried-out"
    }
   ],
   "account": "Col. Delacroix kept his line beside the 1st and edged it a little forward. He fired obliquely on the bridge and on the head of the column. He committed nothing further."
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
   "account": "Maj. Verneuil has no orders. He remained in reserve on the High road, restless but unable to charge across the bridge against the volleys."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1450,
   "facingDeg": 180,
   "formation": "column",
   "strength": 500,
   "morale": 55,
   "fatigue": 38,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "red-r1-3",
     "result": "carried-out"
    }
   ],
   "account": "Col. Brandt went at the bridge at the double in column, without firing. Volleys cut the head of the column down on the span and it reached the far end. There the bayonet charge was stopped by the Blue line and fell back in disorder onto the middle of the bridge. He is re-forming.",
   "departure": "The projection leaves the battalion holding at 2050,1290 and ignores its order to storm the bridge. The order arrived at minute 2 and the bridge is only 110 m away. I ruled the assault went in, was shot down on the span and was repulsed, costing about 150 men and heavy morale. It ends about 160 m from the projected point."
  },
  {
   "unitId": "red-2",
   "x": 2200,
   "y": 1385,
   "facingDeg": 180,
   "formation": "line",
   "strength": 645,
   "morale": 68,
   "fatigue": 20,
   "ammo": 96,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "red-r2-3",
     "result": "carried-out"
    }
   ],
   "account": "Col. Hartmann lined the north bank as ordered. The far bank is at the edge of effective range, so his fire was scattered and did little. He stays there and waits for further orders.",
   "departure": "The projection leaves the battalion at 2250,1300. The order was to line the bank, so I moved it to the river edge (about 100 m). It exchanged only a little long-range fire."
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
   "account": "Maj. von Reiter has no orders. He watched from the west flank and kept his squadron out of the fire."
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
   "side": "blue",
   "unitId": "red-3",
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
   "by": "red-2",
   "when": "end"
  }
 ],
 "summary": "Red-1 stormed the bridge in column as ordered and was repulsed at the south end by Blue's volleys and bayonets: Red-1 650→500 men, morale 55; Blue-1 600→560. Red-1 now stands disordered on the bridge at 2050,1450. Blue-1 holds the south bank at 2050,1620 and Blue-2 stands beside it. Red-2 lines the north bank and its fire is ineffective at that range. Red-3 and Blue-3 are idle. Watch whether Brandt renews the assault, and whether Verneuil charges the bridge.",
 "precedents": [
  "A line battalion cannot form on the bridge itself; defenders hold the bank at its end.",
  "A column crossing the 200 m bridge under volleys takes heavy losses and is repulsed by formed infantry."
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
   "x": 1990,
   "y": 1640,
   "facingDeg": 5,
   "formation": "line",
   "strength": 565,
   "morale": 80,
   "fatigue": 10,
   "ammo": 78,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "blue-b1-3",
     "result": "carried-out"
    }
   ],
   "account": "Col. Aubry took the order as written. He closed his line to within forty paces of the southern end of the bridge, so that every musket bore on it. When the enemy column came over at the run he held his fire until its head was off the planking, then gave it volley upon volley. The head reached his centre and there was a short bayonet struggle before the column recoiled. The line stands, somewhat thinned, and holds.",
   "departure": "The projection sets a 600-man battalion in line on the bridge itself, which cannot be done. Holding the bridge means commanding its southern exit from the bank. The losses come from repelling a bayonet assault that the projection omitted."
  },
  {
   "unitId": "blue-2",
   "x": 2120,
   "y": 1660,
   "facingDeg": 340,
   "formation": "line",
   "strength": 542,
   "morale": 75,
   "fatigue": 5,
   "ammo": 85,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "blue-b2-3",
     "result": "carried-out"
    }
   ],
   "account": "Col. Delacroix kept his line beside the 1st and wheeled his left half-company to bear obliquely on the bridge. His volleys raked the flank of the column as it came off the planking. A battalion firing from the far bank did him little harm at that distance. He did not stir from his ground."
  },
  {
   "unitId": "blue-3",
   "x": 2050,
   "y": 1820,
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
   "account": "Maj. Verneuil brought the squadron up a short way behind the infantry and stood ready to charge anything that broke through. The column was thrown back before he had cause to go in. He saw no sense in pursuing over a bridge into an enemy line and stayed where he was, chafing."
  },
  {
   "unitId": "red-1",
   "x": 2050,
   "y": 1380,
   "facingDeg": 180,
   "formation": "column",
   "strength": 480,
   "morale": 48,
   "fatigue": 40,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "red-r1-3",
     "result": "partly"
    }
   ],
   "account": "Col. Brandt went at the bridge at once, in column, at the double and with the bayonet, as ordered. The head crossed under a storm of musketry from two lines on the far bank. It reached the enemy's line at the southern end but could not deploy off the narrow roadway. It was flung back with heavy loss and has rallied, shaken, at the northern end of the bridge.",
   "departure": "The projection left the battalion standing still, despite a storming order that arrived in its second minute and a commander who presses hard. A column defiling across a bridge into the converging close volleys of two fresh battalions is repulsed with heavy loss."
  },
  {
   "unitId": "red-2",
   "x": 2200,
   "y": 1410,
   "facingDeg": 200,
   "formation": "line",
   "strength": 650,
   "morale": 68,
   "fatigue": 22,
   "ammo": 85,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "red-r2-3",
     "result": "carried-out"
    }
   ],
   "account": "Col. Hartmann marched his line down to the river bank east of the bridge and opened fire on the enemy battalion beyond, as ordered. The river is wide and the range was long, so his fire did little execution. He watched the column fall back across the bridge and stays on the bank awaiting orders.",
   "departure": "Lining the bank, as ordered, took the battalion about 120 m from its projected position, which stood still."
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
   "account": "Maj. von Reiter had no new orders and kept his squadron where it stood, west of the road, watching the fight at the bridge."
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
   "unitId": "red-1",
   "when": "end"
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
 "summary": "Red's vanguard stormed the bridge in column with the bayonet and was repulsed with about 170 lost by the converging volleys of blue-1 and blue-2; it now stands shaken (morale 48) at the north end, 2050,1380. Blue-1 commands the south exit from the bank at 1990,1640 rather than standing on the bridge, as the projection had it; it lost 35 men in the brief melee, blue-2 lost 8 to long-range fire. Red-2 lined the north bank east of the bridge but its fire across the 200 m river was at extreme range and of little effect; both cavalry squadrons stood fast. The bridge and objective remain in Blue's hands, with no one on them. Blue's cavalry commander declined to pursue over the bridge into formed enemy.",
 "precedents": [
  "A battalion cannot form line on the bridge; holding the bridge means commanding its exit from the near bank.",
  "Musketry across the 200 m river at troops standing back from the far bank is at extreme range and does little harm."
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
   "x": 2050,
   "y": 1500,
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
     "orderId": "blue-b1-3",
     "result": "carried-out"
    }
   ],
   "account": "The 1st Battalion acted as the staff tables direct."
  },
  {
   "unitId": "blue-2",
   "x": 2120,
   "y": 1660,
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
   "orders": [
    {
     "orderId": "blue-b2-3",
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
   "y": 1290,
   "facingDeg": 180,
   "formation": "column",
   "strength": 650,
   "morale": 80,
   "fatigue": 17,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "red-r1-3",
     "result": "carried-out"
    }
   ],
   "account": "The Vanguard Battalion acted as the staff tables direct."
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 1300,
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
     "orderId": "red-r2-3",
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
   "side": "blue",
   "unitId": "red-3",
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
   "unitId": "red-3",
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
