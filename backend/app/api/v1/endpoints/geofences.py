from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.user import User
from app.models.geofence import Geofence, GeofenceEvent
from app.schemas.geofence import GeofenceCreate, GeofenceResponse, GeofenceEventResponse
from app.api.v1.deps import get_current_user, log_audit

router = APIRouter()

@router.get("", response_model=List[GeofenceResponse])
def list_geofences(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return db.query(Geofence).filter(Geofence.user_id == current_user.id).all()

@router.post("", response_model=GeofenceResponse, status_code=status.HTTP_201_CREATED)
def create_geofence(
    gf_in: GeofenceCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    gf = Geofence(
        user_id=current_user.id,
        name=gf_in.name,
        latitude=gf_in.latitude,
        longitude=gf_in.longitude,
        radius_meters=gf_in.radius_meters or 200.0,
        description=gf_in.description
    )
    db.add(gf)
    db.commit()
    db.refresh(gf)

    log_audit(db, user_id=current_user.id, action="GEOFENCE_CREATED", resource=f"geofence:{gf.id}")
    return gf

@router.delete("/{geofence_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_geofence(
    geofence_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    gf = db.query(Geofence).filter(Geofence.id == geofence_id, Geofence.user_id == current_user.id).first()
    if not gf:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Geofence not found")
    
    log_audit(db, user_id=current_user.id, action="GEOFENCE_DELETED", resource=f"geofence:{gf.id}")
    db.delete(gf)
    db.commit()

@router.get("/events", response_model=List[GeofenceEventResponse])
def list_geofence_events(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    events = (
        db.query(GeofenceEvent)
        .join(Geofence)
        .filter(Geofence.user_id == current_user.id)
        .order_by(GeofenceEvent.timestamp.desc())
        .limit(100)
        .all()
    )
    return events
