# Case garbled-order: A garbled order

**What this case tests.** Blue-2's order to extend the line east was garbled on the ride (the umpire is told `garbled: true` and the true text). D39: the umpire must have it misread: the battalion goes somewhere plausibly wrong (the wrong side of the road, the wrong distance), with result "misread" and an account that shows the misunderstanding.

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
   "x": 1950,
   "y": 300,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
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
   "id": "red-2",
   "side": "red",
   "name": "Line Battalion",
   "type": "line_infantry",
   "kind": "infantry",
   "commander": "Col. Hartmann",
   "personality": [],
   "character": "by the book; waits for orders",
   "x": 2250,
   "y": 150,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 70,
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
   "orderId": "b2-12",
   "side": "blue",
   "to": "blue-2",
   "text": "Extend the line 300 paces east along the river bank and watch for a crossing downstream.",
   "courier": "fast",
   "sentTurn": 1,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 6,
   "garbled": true
  },
  {
   "orderId": "r1-12",
   "side": "red",
   "to": "red-1",
   "text": "Stand fast.",
   "courier": "safe",
   "sentTurn": 1,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 2
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
    "x": 2400,
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
    "x": 1950,
    "y": 300,
    "facingDeg": 180,
    "formation": "line",
    "strength": 650,
    "morale": 80,
    "fatigue": 0,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "hold"
    }
   },
   {
    "unitId": "red-2",
    "x": 2250,
    "y": 150,
    "facingDeg": 180,
    "formation": "line",
    "strength": 650,
    "morale": 70,
    "fatigue": 0,
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
   "minute 2: unit.arrived {\"unitId\":\"red-1\",\"at\":[1950,300]}",
   "minute 9: unit.arrived {\"unitId\":\"blue-2\",\"at\":[2400,1680]}"
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
   "account": "Col. Aubry had no orders and held his line covering the bridge. The 2nd Battalion marched past his rear to take post on his left."
  },
  {
   "unitId": "blue-2",
   "x": 1740,
   "y": 1660,
   "facingDeg": 0,
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
     "orderId": "b2-12",
     "result": "misread"
    }
   ],
   "account": "Col. Delacroix's order came at minute 6, and the aide's message was confused: he took it as 'extend the line 300 paces west along the bank and watch for a crossing upstream'. He carefully broke into column and marched behind the 1st Battalion. He re-formed line on its left about 300 paces along the bank and posted pickets to watch the river upstream.",
   "departure": "The order was garbled. The colonel took 'east' for 'west' and 'downstream' for 'upstream', so the battalion extended the line on the 1st Battalion's left at (1740,1660), not 300 paces east at (2400,1680). The bridge's east flank is now uncovered."
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
   "account": "Maj. Verneuil had no orders and held his squadron behind the infantry, astride the road."
  },
  {
   "unitId": "red-1",
   "x": 1950,
   "y": 300,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 80,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r1-12",
     "result": "carried-out"
    }
   ],
   "account": "Col. Brandt received the order to stand fast and obeyed, though with ill grace, holding his line by the road."
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 150,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 70,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Hartmann had no orders, so he held his line and waited for instructions."
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
   "account": "Maj. von Reiter had no orders and held his squadron in place."
  }
 ],
 "observations": [],
 "summary": "Turn 1 (0-20). A quiet turn: no enemy came within anyone's sight, and nothing was fought. Blue's order for the 2nd Battalion to extend 300 paces east along the river and watch downstream reached it at minute 6 but was garbled in delivery. Its cautious colonel understood west and upstream instead. He marched the battalion behind the 1st and formed line on its left at about (1740,1660), watching the river upstream. As a result, the ground east of the bridge is now open, the opposite of what Blue intended. Red's Vanguard Battalion received 'Stand fast' at minute 2 and held. Every other unit held without orders."
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
   "account": "Col. Aubry has no order and holds his line facing the bridge. He sees the 2nd Battalion march off along the river bank to the east and supposes it has its reasons. Nothing of the enemy is in sight."
  },
  {
   "unitId": "blue-2",
   "x": 3540,
   "y": 1680,
   "facingDeg": 90,
   "formation": "column",
   "strength": 550,
   "morale": 75,
   "fatigue": 12,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "move",
    "x": 3950,
    "y": 1680
   },
   "orders": [
    {
     "orderId": "b2-12",
     "result": "misread"
    }
   ],
   "account": "Col. Delacroix gets his order at about the sixth minute. The written figure is blotted, and he reads it as 3,000 paces rather than 300. Cautious, he reads it twice, but the order says extend the line east and watch for a crossing downstream, so he forms column and marches east along the south bank to carry it out, and is still marching at the end of the turn, over a kilometre from the 1st Battalion.",
   "departure": "The projection takes the order as written: 300 paces east, to (2400,1680), where the battalion halts. The courier's order is garbled, and the colonel reads 3,000 paces instead of 300, so he marches the 1,400 m that the rest of the turn allows, ending at (3540,1680) and still moving, more than a kilometre from the projected position."
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
   "account": "Maj. Verneuil has no order and holds behind the infantry. He sees the 2nd Battalion march away to the east and is puzzled, but does not stir without orders."
  },
  {
   "unitId": "red-1",
   "x": 1950,
   "y": 300,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 80,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r1-12",
     "result": "carried-out"
    }
   ],
   "account": "Col. Brandt is told to stand fast and does, in line facing south, chafing."
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 150,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 70,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Hartmann has no order and holds his position, by the book."
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
   "account": "Maj. von Reiter has no order and holds his position."
  }
 ],
 "observations": [],
 "summary": "Blue-2 got the order to extend the line east along the river bank and watch for a crossing downstream, but it came in garbled. Col. Delacroix read '300 paces' as '3,000' and marched east in column from about minute 6, covering about 1,400 m to (3540,1680) and still marching, so the Blue line at the bridge is now held by the 1st Battalion with the cavalry behind. Red-1 stood fast; all the other units held. No contact: Red is still 1,400 m or more from Blue's infantry, and nobody saw anybody."
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
   "x": 2400,
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
   "orders": [
    {
     "orderId": "b2-12",
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
   "x": 1950,
   "y": 300,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 80,
   "fatigue": 0,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r1-12",
     "result": "carried-out"
    }
   ],
   "account": "The Vanguard Battalion acted as the staff tables direct."
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 150,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 70,
   "fatigue": 0,
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
