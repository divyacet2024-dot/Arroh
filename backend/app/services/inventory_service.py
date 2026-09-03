"""Compatibility façade for PHC inventory forecasting."""

from app.services.stock_predictor import predict_phc_stockouts

__all__ = ["predict_phc_stockouts"]
