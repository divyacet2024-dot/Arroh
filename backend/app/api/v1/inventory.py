"""HTTP interface for PHC essential-supply demand and stockout forecasting."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.triage import TriageLog
from app.db.session import get_db_session
from app.schemas.inventory import StockoutForecastResponseSchema
from app.services.stock_predictor import predict_phc_stockouts

router = APIRouter(prefix="/inventory", tags=["PHC Inventory"])


@router.get("/forecast/{phc_id}", response_model=StockoutForecastResponseSchema, summary="Forecast PHC stockout risk")
async def forecast_inventory(phc_id: str, db: AsyncSession = Depends(get_db_session)) -> StockoutForecastResponseSchema:
    """Build a facility forecast from recently synced records assigned to that PHC."""

    logs = (await db.scalars(select(TriageLog).where(TriageLog.phc_id == phc_id))).all()
    active_logs = [
        {"symptoms": log.symptoms or [], "triage_status": log.triage_status.value}
        for log in logs
    ]
    return StockoutForecastResponseSchema(
        phc_id=phc_id,
        active_patient_log_count=len(active_logs),
        forecasts=predict_phc_stockouts(phc_id, active_logs),
    )
