# Case impossible-order: An order that cannot be carried out

**What this case tests.** Blue-2 is ordered to wade the river where it stands (200 m of deep water with no ford) and seize the enemy headquarters at the north edge within the turn. A good umpire does not move it across the river: the order is refused or only partly carried out (for example by marching to the bridge), and the account says why. Red-3 is told to capture the whole enemy army; the umpire keeps the outcome within what one squadron can do.

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
   "orderId": "b2-9",
   "side": "blue",
   "to": "blue-2",
   "text": "Wade the river where you stand, straight across, and seize the enemy headquarters at the north edge of the field before the quarter hour.",
   "courier": "fast",
   "sentTurn": 1,
   "status": "arrived",
   "arrivedAtMinuteOfTurn": 3
  },
  {
   "orderId": "r3-9",
   "side": "red",
   "to": "red-3",
   "text": "Ride down and capture the whole enemy army.",
   "courier": "fast",
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
    "facingDeg": 103,
    "formation": "line",
    "strength": 589,
    "morale": 76,
    "fatigue": 5,
    "ammo": 95,
    "status": "active",
    "continuing": {
     "kind": "hold"
    }
   },
   {
    "unitId": "blue-2",
    "x": 2050,
    "y": 60,
    "facingDeg": 325,
    "formation": "line",
    "strength": 541,
    "morale": 72,
    "fatigue": 2,
    "ammo": 100,
    "status": "active",
    "continuing": {
     "kind": "idle"
    }
   },
   {
    "unitId": "blue-3",
    "x": 1650,
    "y": 400,
    "facingDeg": 270,
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
    "x": 1950,
    "y": 300,
    "facingDeg": 145,
    "formation": "line",
    "strength": 647,
    "morale": 79,
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
    "facingDeg": 283,
    "formation": "line",
    "strength": 0,
    "morale": 0,
    "fatigue": 18,
    "ammo": 85,
    "status": "destroyed",
    "continuing": {
     "kind": "idle"
    }
   }
  ],
  "events": [
   "minute 6: unit.arrived {\"unitId\":\"red-3\",\"at\":[2050,1700]}",
   "minute 7: combat.morale {\"unitId\":\"red-3\",\"lossPercent\":12.4,\"roll\":9,\"needed\":6,\"passed\":false,\"morale\":50}",
   "minute 7: combat.fire {\"attacker\":\"blue-1\",\"target\":\"red-3\",\"distance\":92.2,\"cover\":1,\"aspect\":\"flank\",\"melee\":false,\"die\":6,\"casualties\":27.3,\"targetStrength\":192.8,\"targetMorale\":50}",
   "minute 7: combat.fire {\"attacker\":\"red-3\",\"target\":\"blue-1\",\"distance\":92.2,\"cover\":1,\"aspect\":\"flank\",\"melee\":false,\"die\":5,\"casualties\":8.1,\"targetStrength\":591.9,\"targetMorale\":76.6}",
   "minute 9: combat.morale {\"unitId\":\"red-3\",\"lossPercent\":7.6,\"roll\":9,\"needed\":4,\"passed\":false,\"morale\":30.8}",
   "minute 9: combat.fire {\"attacker\":\"blue-1\",\"target\":\"red-3\",\"distance\":92.2,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":5,\"casualties\":14.7,\"targetStrength\":178.1,\"targetMorale\":30.8}",
   "minute 9: combat.fire {\"attacker\":\"red-3\",\"target\":\"blue-1\",\"distance\":92.2,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":2,\"casualties\":1.5,\"targetStrength\":590.4,\"targetMorale\":76.1}",
   "minute 11: combat.morale {\"unitId\":\"red-3\",\"lossPercent\":6.6,\"roll\":10,\"needed\":2,\"passed\":false,\"morale\":13.7}",
   "minute 11: combat.fire {\"attacker\":\"blue-1\",\"target\":\"red-3\",\"distance\":92.2,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":4,\"casualties\":11.7,\"targetStrength\":166.4,\"targetMorale\":13.7}",
   "minute 11: combat.fire {\"attacker\":\"blue-2\",\"target\":\"red-1\",\"distance\":175.9,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":2,\"casualties\":2.8,\"targetStrength\":647.2,\"targetMorale\":79.1}",
   "minute 11: combat.fire {\"attacker\":\"red-1\",\"target\":\"blue-2\",\"distance\":175.9,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":5,\"casualties\":8.5,\"targetStrength\":541.5,\"targetMorale\":71.9}",
   "minute 11: combat.fire {\"attacker\":\"red-3\",\"target\":\"blue-1\",\"distance\":92.2,\"cover\":1,\"aspect\":\"front\",\"melee\":false,\"die\":2,\"casualties\":1.2,\"targetStrength\":589.2,\"targetMorale\":75.7}",
   "minute 11: unit.broken {\"unitId\":\"red-3\",\"morale\":13.7}",
   "minute 13: unit.arrived {\"unitId\":\"blue-2\",\"at\":[2050,60]}",
   "minute 16: unit.arrived {\"unitId\":\"red-3\",\"at\":[1550,400]}",
   "minute 17: combat.morale {\"unitId\":\"red-3\",\"lossPercent\":45.7,\"roll\":8,\"needed\":0,\"passed\":false,\"morale\":0}",
   "minute 17: combat.fire {\"attacker\":\"blue-3\",\"target\":\"red-3\",\"distance\":100,\"cover\":1,\"aspect\":\"rear\",\"melee\":true,\"die\":2,\"casualties\":76.1,\"targetStrength\":90.3,\"targetMorale\":0}",
   "minute 17: unit.rallyFailed {\"unitId\":\"red-3\",\"reason\":\"pressed\"}",
   "minute 19: combat.fire {\"attacker\":\"blue-3\",\"target\":\"red-3\",\"distance\":100,\"cover\":1,\"aspect\":\"rear\",\"melee\":true,\"die\":5,\"casualties\":190.3,\"targetStrength\":0,\"targetMorale\":0}",
   "minute 19: unit.destroyed {\"unitId\":\"red-3\"}"
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
   "facingDeg": 103,
   "formation": "line",
   "strength": 589,
   "morale": 76,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b2-9",
     "result": "partly"
    }
   ],
   "account": "Col. Aubry cautiously moved his battalion to the river, but stopped short of the bridge, waiting for the second battalion to arrive."
  },
  {
   "unitId": "blue-2",
   "x": 2050,
   "y": 60,
   "facingDeg": 325,
   "formation": "line",
   "strength": 541,
   "morale": 72,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "b2-9",
     "result": "partly"
    }
   ],
   "account": "Col. Delacroix's cautious nature led him to march his battalion to the river, but he hesitated to cross without orders."
  },
  {
   "unitId": "blue-3",
   "x": 1650,
   "y": 400,
   "facingDeg": 270,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "b2-9",
     "result": "not-arrived"
    }
   ],
   "account": "Maj. Verneuil's aggressive nature made him impatient to move, but he was still holding his position, awaiting further orders."
  },
  {
   "unitId": "red-1",
   "x": 1950,
   "y": 300,
   "facingDeg": 145,
   "formation": "line",
   "strength": 647,
   "morale": 79,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r3-9",
     "result": "not-arrived"
    }
   ],
   "account": "Col. Brandt's aggressive nature drove him to move his battalion towards the river, but he was cautious and did not cross."
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 150,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 70,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r3-9",
     "result": "not-arrived"
    }
   ],
   "account": "Col. Hartmann's by-the-book nature kept his battalion in position, awaiting further orders."
  },
  {
   "unitId": "red-3",
   "x": 1550,
   "y": 400,
   "facingDeg": 283,
   "formation": "line",
   "strength": 0,
   "morale": 0,
   "status": "destroyed",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "r3-9",
     "result": "partly"
    }
   ],
   "account": "Maj. von Reiter's dashing nature led him to overextend his squadron, resulting in its destruction."
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
 "summary": "In the first turn, both sides cautiously moved their units towards the river. The blue side's 1st and 2nd battalions approached the river, while the 3rd cavalry squadron remained in position. The red side's 1st and 2nd battalions also moved cautiously, with the 3rd hussar squadron overextending and being destroyed. Combat broke out, with the blue side inflicting significant casualties on the red side, leading to the destruction of the red 3rd squadron. The red 3rd squadron's morale broke, and it was destroyed. The blue side's 2nd battalion arrived at the river, but the 1st battalion hesitated. The red side's 2nd battalion remained in position, awaiting further orders."
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
   "facingDeg": 103,
   "formation": "line",
   "strength": 589,
   "morale": 76,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b2-9",
     "result": "carried-out"
    }
   ],
   "account": "Col. Aubry held his line, as ordered, despite the enemy's attempts to break through.",
   "departure": "None"
  },
  {
   "unitId": "blue-2",
   "x": 2050,
   "y": 60,
   "facingDeg": 325,
   "formation": "line",
   "strength": 541,
   "morale": 72,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "b2-9",
     "result": "carried-out"
    }
   ],
   "account": "Col. Delacroix waded the river, as ordered, but his men were slow to cross.",
   "departure": "None"
  },
  {
   "unitId": "blue-3",
   "x": 1650,
   "y": 400,
   "facingDeg": 270,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "b2-9",
     "result": "carried-out"
    }
   ],
   "account": "Maj. Verneuil held his position, as ordered, but his men were eager to charge.",
   "departure": "None"
  },
  {
   "unitId": "red-1",
   "x": 1950,
   "y": 300,
   "facingDeg": 145,
   "formation": "line",
   "strength": 647,
   "morale": 79,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r3-9",
     "result": "misread"
    }
   ],
   "account": "Col. Brandt misread the order to capture the enemy army and instead held his position.",
   "departure": "None"
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 150,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 70,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r3-9",
     "result": "misread"
    }
   ],
   "account": "Col. Hartmann misread the order to capture the enemy army and instead held his position.",
   "departure": "None"
  },
  {
   "unitId": "red-3",
   "x": 1550,
   "y": 400,
   "facingDeg": 283,
   "formation": "line",
   "strength": 0,
   "morale": 0,
   "status": "destroyed",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "r3-9",
     "result": "misread"
    }
   ],
   "account": "Maj. von Reiter's unit was destroyed in the previous turn.",
   "departure": "None"
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
 "summary": "The blue units held their positions, while the red units were slow to react to the orders. The red cavalry unit was destroyed in the previous turn."
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
   "strength": 589,
   "morale": 76,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "The battalion held its ground, maintaining a steady line as the enemy cavalry pressed the attack. Despite heavy fire, the discipline held, absorbing the initial shock of the charge.",
   "departure": "The projection showed a slight increase in fatigue (5) and ammo loss (5), which is consistent with holding a line under fire."
  },
  {
   "unitId": "blue-2",
   "x": 2050,
   "y": 200,
   "facingDeg": 180,
   "formation": "line",
   "strength": 541,
   "morale": 72,
   "status": "active",
   "continuing": {
    "kind": "move",
    "x": 2050,
    "y": 50
   },
   "orders": [
    {
     "orderId": "b2-9",
     "result": "carried-out"
    }
   ],
   "account": "Col. Delacroix, being cautious, utilized the bridge to cross the river safely. He then advanced slowly and methodically towards the enemy headquarters, fulfilling the core objective of the order while maintaining formation.",
   "departure": "The unit advanced significantly towards the HQ, successfully crossing the river barrier and engaging the enemy line."
  },
  {
   "unitId": "blue-3",
   "x": 1650,
   "y": 400,
   "facingDeg": 270,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [],
   "account": "The cavalry squadron maintained its position, observing the movements of the enemy forces and preparing for potential counter-attacks, remaining in reserve.",
   "departure": "The projection showed a slight movement (1650, 400) and fatigue increase (3), consistent with maintaining a ready position."
  },
  {
   "unitId": "red-1",
   "x": 1950,
   "y": 300,
   "facingDeg": 145,
   "formation": "line",
   "strength": 647,
   "morale": 79,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "The Vanguard Battalion held its position, engaging the advancing Blue forces. Col. Brandt pressed the attack hard, maintaining fire discipline while absorbing the pressure from the enemy.",
   "departure": "The unit engaged Blue-2, resulting in minor losses and morale fluctuation, consistent with the projection."
  },
  {
   "unitId": "red-2",
   "x": 2250,
   "y": 150,
   "facingDeg": 180,
   "formation": "line",
   "strength": 650,
   "morale": 70,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Hartmann maintained strict adherence to the defensive plan, holding the line and waiting for further orders, refusing to commit reserves prematurely.",
   "departure": "The unit remained static, maintaining its defensive posture."
  },
  {
   "unitId": "red-3",
   "x": 1550,
   "y": 400,
   "facingDeg": 283,
   "formation": "line",
   "strength": 0,
   "morale": 0,
   "status": "destroyed",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "r3-9",
     "result": "carried-out"
    }
   ],
   "account": "Maj. von Reiter, driven by his aggressive nature and desire for glory, launched a full-speed charge against the enemy line. The charge was costly, and the unit was ultimately broken and destroyed by the sustained fire and melee engagement.",
   "departure": "The unit was destroyed in combat, matching the projection. The aggressive order led to a catastrophic engagement."
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
  }
 ],
 "summary": "The turn saw significant action centered around the defensive line. Blue-2 successfully crossed the river via the bridge and advanced towards the enemy headquarters, fulfilling the aggressive order given by its commander. Red-3, driven by its aggressive nature, launched a full-scale charge against the Blue line. This charge proved disastrous, resulting in the complete destruction of the Hussar Squadron. Blue-1 held its position against the cavalry assault, while Blue-3 maintained its observation post. The overall strategic situation remains tense, with Blue-2 having penetrated the defensive perimeter."
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
   "facingDeg": 10,
   "formation": "line",
   "strength": 600,
   "morale": 80,
   "fatigue": 1,
   "ammo": 97,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "Col. Aubry had no orders and held his line. When a troop of enemy hussars clattered over the bridge around minute 9, his right companies gave them a volley at about 120 m and they turned back. He held his ground."
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
   "ammo": 98,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "b2-9",
     "result": "refused"
    }
   ],
   "account": "Col. Delacroix read the order twice. The river before him is deep and unfordable, the bridge is the only crossing, and the enemy headquarters lies some 1.6 km beyond. Wading across and taking it inside a quarter hour cannot be done. He would not drown his battalion, so he held his line and sent an aide back to ask what was really wanted. His left companies fired at enemy horse on the bridge.",
   "departure": "The engine marched the battalion straight over the impassable river to the enemy headquarters (2050,60) in ten minutes. The river cannot be crossed except by the bridge, and the order cannot be carried out, so the colonel refused it and held."
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
   "account": "Maj. Verneuil had no orders. He readied to charge the enemy hussars if they cleared the bridge, but the infantry's volley turned them back first, so he held behind the line.",
   "departure": "The engine moved the squadron, which had no orders, across the impassable river to (1650,400) and had it cut down the enemy hussars. The river can only be crossed by the bridge, and a pursuit of 1.5 km beyond enemy infantry is not plausible, so it stayed behind its infantry."
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
   "orders": [],
   "account": "Col. Brandt had no orders and held his line by the road. No enemy came near."
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
   "account": "Col. Hartmann had no orders and held his line."
  },
  {
   "unitId": "red-3",
   "x": 2000,
   "y": 1250,
   "facingDeg": 180,
   "formation": "line",
   "strength": 209,
   "morale": 79,
   "fatigue": 20,
   "ammo": 96,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r3-9",
     "result": "partly"
    }
   ],
   "account": "Maj. von Reiter took the extravagant order as licence to ride at the enemy and see what he could snatch. He galloped south to the bridge and sent his leading troop over it. On the far side he found two battalions in line and a squadron of horse waiting. A volley emptied a few saddles, and even he saw that 220 hussars do not capture an army. He pulled back to the north bank and watched the enemy.",
   "departure": "The engine had the hussars charge the far bank, break under fire, flee and then be wiped out by Blue cavalry that had crossed the impassable river. Only the leading troop crossed; it lost 11 men to one volley and the squadron re-formed north of the river."
  }
 ],
 "observations": [
  {
   "side": "blue",
   "by": "blue-1",
   "unitId": "red-3",
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
   "unitId": "red-3",
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
 "summary": "Turn 1 (0-20). Both sides sent impossible orders. Blue told its 2nd Battalion to wade the river and seize the Red headquarters within a quarter hour. The river is impassable except by the bridge and the headquarters is 1.6 km off, so the cautious colonel refused, held his line and asked for clarification. Red told its hussars to capture the whole Blue army. Their dashing major rode for the bridge and pushed a troop across around minute 9. It met a volley from the Blue 1st Battalion's right at about 120 m, lost 11 men and turned back. The squadron re-formed on the north bank at about (2000,1250), in sight of the Blue line. Blue's cavalry stood ready to charge but was not needed. No other unit moved. The engine's projection was rejected: it had Blue infantry and cavalry crossing the impassable river and the hussars destroyed."
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
   "account": "Col. Aubry has no order and holds his line facing the bridge. A single enemy horse squadron appears on the far bank at about 300 m, out of range, and he keeps his men quiet."
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
   "orders": [
    {
     "orderId": "b2-9",
     "result": "refused"
    }
   ],
   "account": "Col. Delacroix receives an order to wade the river where he stands and seize the enemy headquarters at the north edge of the field, within the quarter hour. The river is 200 m wide and cannot be forded, and the headquarters lies a mile and more beyond it, past two battalions. He judges the order impossible as written and will not throw his battalion into the water or leave the line on it. He holds his position and sends word back that he cannot carry it out."
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
   "account": "Maj. Verneuil has no order and holds behind the infantry. He sees a squadron of horse come down to the far bank, and wants to go at it, but the river is between."
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
   "orders": [],
   "account": "Col. Brandt has no order and holds his line facing south."
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
   "x": 2030,
   "y": 1380,
   "facingDeg": 180,
   "formation": "line",
   "strength": 220,
   "morale": 85,
   "fatigue": 15,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [
    {
     "orderId": "r3-9",
     "result": "partly"
    }
   ],
   "account": "Maj. von Reiter reads his order as: ride down and go at the enemy. A squadron cannot capture an army, and he does not try. He rides down the high road at once as far as the river and halts at the north end of the bridge, where he sees two battalions in line and a squadron of horse behind them on the far bank. The bridge is 200 m long and flanked by the two lines, and he will not send his men over it into their volleys. He halts there and watches.",
   "departure": "Projection sends the hussars over the bridge to (2050,1700) against two formed battalions, where they are shot to pieces and finally destroyed (strength 0). The order cannot be carried out literally; a dashing but not mad officer rides down to the enemy as ordered but halts at the bridge head in front of the two lines. They are out of musket range (about 300 m), so the squadron takes no losses, and ends at (2030,1380) instead of at the far end of the bridge."
  }
 ],
 "observations": [
  {
   "side": "blue",
   "by": "blue-1",
   "unitId": "red-3",
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
   "unitId": "red-3",
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
 "summary": "Blue-2 was ordered to wade the river where it stood and seize the enemy headquarters. The river is impassable except by the bridge and the headquarters is over a mile away behind two Red battalions, so the colonel refused the order as impossible and held his line. Red-3 was ordered to capture the whole enemy army; the hussar commander took it as an order to ride down at the enemy, rode to the north end of the bridge and, seeing two formed battalions and cavalry beyond, halted there. The squadron sat just beyond musket range and no shots were fired. The projection had the hussars charge the bridge and be destroyed; the umpire did not accept that. All other units held. No casualties."
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
   "facingDeg": 103,
   "formation": "line",
   "strength": 589,
   "morale": 76,
   "fatigue": 5,
   "ammo": 95,
   "status": "active",
   "continuing": {
    "kind": "hold"
   },
   "orders": [],
   "account": "The 1st Battalion acted as the staff tables direct."
  },
  {
   "unitId": "blue-2",
   "x": 2050,
   "y": 60,
   "facingDeg": 325,
   "formation": "line",
   "strength": 541,
   "morale": 72,
   "fatigue": 2,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "b2-9",
     "result": "carried-out"
    }
   ],
   "account": "The 2nd Battalion acted as the staff tables direct."
  },
  {
   "unitId": "blue-3",
   "x": 1650,
   "y": 400,
   "facingDeg": 270,
   "formation": "line",
   "strength": 200,
   "morale": 85,
   "fatigue": 3,
   "ammo": 100,
   "status": "active",
   "continuing": {
    "kind": "idle"
   },
   "orders": [],
   "account": "The Cavalry Squadron acted as the staff tables direct."
  },
  {
   "unitId": "red-1",
   "x": 1950,
   "y": 300,
   "facingDeg": 145,
   "formation": "line",
   "strength": 647,
   "morale": 79,
   "fatigue": 0,
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
   "facingDeg": 283,
   "formation": "line",
   "strength": 0,
   "morale": 0,
   "fatigue": 18,
   "ammo": 85,
   "status": "destroyed",
   "continuing": {
    "kind": "idle"
   },
   "orders": [
    {
     "orderId": "r3-9",
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
