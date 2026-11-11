"""data_validation -- implements 1.1.2 Validate and Prepare Data."""


def validate_and_prepare_data(
    acquired_datasets_and_metadata: dict, *, data_quality_criteria: dict
) -> tuple[dict, dict]:
    """in: acquired_datasets_and_metadata. control: data_quality_criteria.
    out: (prepared_datasets, data_quality_report).
    (mechanism: GIS processing tools)"""
    raise NotImplementedError
