"""Response models for predictive PHC critical-supply forecasting."""

from typing import Literal

from pydantic import BaseModel, Field


class StockoutForecastItemSchema(BaseModel):
    """Forecast for one clinically critical PHC supply."""

    medicine_name: str
    current_stock_level: float = Field(ge=0)
    estimated_daily_consumption: float = Field(gt=0)
    reorder_threshold: float = Field(ge=0)
    estimated_days_until_stockout: float = Field(ge=0)
    status: Literal["CRITICAL_STOCKOUT_RISK", "STABLE", "ADEQUATE"]
    demand_signal: str


class StockoutForecastResponseSchema(BaseModel):
    """Facility-specific stockout forecast generated from recent patient observations."""

    phc_id: str
    active_patient_log_count: int
    forecasts: list[StockoutForecastItemSchema]
