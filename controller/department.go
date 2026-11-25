package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func GetDepartments(c *gin.Context) {
	departments, err := model.GetDepartments()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, departments)
}

func DeleteDepartment(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id < 1 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	department, err := model.DeleteDepartment(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			common.ApiErrorT(c, "Department does not exist")
			return
		}
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "department.delete", map[string]any{
		"id": department.Id, "name": department.Name, "before": department,
	})
	common.ApiSuccess(c, nil)
}

// SaveDepartment accepts only editable fields. IDs and timestamps cannot be
// injected through the JSON body, and enabled must be explicitly supplied.
func SaveDepartment(c *gin.Context) {
	var input struct {
		Code        string `json:"code"`
		Name        string `json:"name"`
		ParentId    int    `json:"parent_id"`
		Owner       string `json:"owner"`
		Description string `json:"description"`
		Enabled     *bool  `json:"enabled"`
	}
	if err := common.DecodeJson(c.Request.Body, &input); err != nil || input.Enabled == nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	department := model.Department{
		Code: input.Code, Name: input.Name, ParentId: input.ParentId,
		Owner: input.Owner, Description: input.Description,
		Enabled: *input.Enabled,
	}
	action := "department.create"
	if c.Request.Method == http.MethodPut {
		id, err := strconv.Atoi(c.Param("id"))
		if err != nil || id < 1 {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		department.Id = id
		action = "department.update"
	}
	before, err := model.SaveDepartment(&department)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			common.ApiErrorT(c, "Department does not exist")
			return
		}
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, action, map[string]any{
		"id": department.Id, "name": department.Name, "before": before, "after": department,
	})
	common.ApiSuccess(c, department)
}
