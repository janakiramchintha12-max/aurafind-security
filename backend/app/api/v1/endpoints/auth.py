from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.core.security import (
    get_password_hash, verify_password, create_access_token, create_refresh_token, decode_token
)
from app.models.user import User
from app.schemas.user import UserCreate, UserLogin, UserResponse, Token, TokenRefreshRequest, UserChangePassword
from app.api.v1.deps import get_current_user, log_audit

router = APIRouter()

def normalize_email(value: str) -> str:
    return value.strip().casefold()

def get_identifier(email: str | None, username: str | None) -> str:
    identifier = username if username is not None else email
    if not identifier or not identifier.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Username is required"
        )
    return normalize_email(identifier)

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    email = get_identifier(user_in.email, user_in.username)
    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account with this username already exists."
        )
    
    user = User(
        email=email,
        hashed_password=get_password_hash(user_in.password),
        full_name=user_in.full_name
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    log_audit(db, user_id=user.id, action="USER_REGISTERED", resource=f"user:{user.id}")
    return user

@router.post("/login", response_model=Token)
def login(user_in: UserLogin, db: Session = Depends(get_db)):
    identifier = get_identifier(user_in.email, user_in.username)
    user = db.query(User).filter(User.email == identifier).first()
    if not user or not verify_password(user_in.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password"
        )
    
    access_token = create_access_token(subject=user.id)
    refresh_token = create_refresh_token(subject=user.id)

    log_audit(db, user_id=user.id, action="AUTH_LOGIN", resource=f"user:{user.id}")
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer"
    }

@router.post("/refresh", response_model=Token)
def refresh_token(token_in: TokenRefreshRequest, db: Session = Depends(get_db)):
    payload = decode_token(token_in.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token"
        )
    
    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    new_access_token = create_access_token(subject=user.id)
    new_refresh_token = create_refresh_token(subject=user.id)

    return {
        "access_token": new_access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer"
    }

@router.post("/logout")
def logout(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    log_audit(db, user_id=current_user.id, action="AUTH_LOGOUT", resource=f"user:{current_user.id}")
    return {"message": "Successfully logged out"}

@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user

@router.post("/change-password")
def change_password(
    payload: UserChangePassword,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect"
        )
    current_user.hashed_password = get_password_hash(payload.new_password)
    db.commit()
    log_audit(db, user_id=current_user.id, action="PASSWORD_CHANGED", resource=f"user:{current_user.id}")
    return {"message": "Password successfully updated"}
