"""
Utility functions for Action Plus analysis.
"""


def compute_score(
    arm_velo: float,
    torso_velo: float,
    abd_footplant: float,
    shoulder_fp: float,
    max_er: float
) -> float:
    """
    Compute kinematic score based on movement parameters.
    
    Scoring logic:
      1) arm_velo * 0.0025
      2) torso_velo * 0.01
      3) abduction@footplant => -1 * (abd_footplant * 1.2)
      4) shoulder ER@footplant => piecewise logic
      5) max_er => piecewise logic => +10 if in 180..210, 0 if in 211..220,
         0 if in 179..(just below 180?), and -10 if <180 or >220
    
    Args:
        arm_velo: Arm velocity
        torso_velo: Torso rotation velocity
        abd_footplant: Abduction at footplant
        shoulder_fp: Shoulder angle at footplant
        max_er: Maximum external rotation
        
    Returns:
        float: Computed score
    """
    # Safety for None => 0
    arm_velo = arm_velo or 0
    torso_velo = torso_velo or 0
    abd_footplant = abd_footplant or 0
    shoulder_fp = shoulder_fp or 0
    max_er = max_er or 0

    score = 0.0

    # 1) Arm velocity
    score += arm_velo * 0.0025

    # 2) Torso velocity
    score += torso_velo * 0.01

    # 3) Abduction @ footplant (negative factor)
    score += -1.0 * (abd_footplant * 1.2)

    # 4) Shoulder ER @ footplant piecewise
    if 35 <= shoulder_fp <= 75:
        score += 30
    elif 76 <= shoulder_fp <= 85:
        score += 15
    elif 86 <= shoulder_fp <= 95:
        score += 0
    elif 96 <= shoulder_fp <= 105:
        score -= 10
    elif shoulder_fp >= 106:
        score -= 20
    elif 25 <= shoulder_fp <= 34:
        score += 15
    elif 15 <= shoulder_fp <= 24:
        score += 0
    elif 5 <= shoulder_fp <= 14:
        score -= 10
    elif shoulder_fp < 5:
        score -= 20

    # 5) Max_ER piecewise
    er_score = 0
    if 180 <= max_er <= 210:
        er_score = 10
    elif 211 <= max_er <= 220:
        er_score = 0
    elif max_er > 220:
        er_score = -10
    elif max_er < 180:
        er_score = -10
    
    score += er_score

    return score

