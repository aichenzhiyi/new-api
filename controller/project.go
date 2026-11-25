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

func GetProjects(c *gin.Context) {
	projects, err := model.GetProjects()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, projects)
}

func DeleteProject(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id < 1 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	project, err := model.DeleteProject(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			common.ApiErrorT(c, "Project does not exist")
			return
		}
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "project.delete", map[string]any{
		"id": project.Id, "name": project.Name, "before": project,
	})
	common.ApiSuccess(c, nil)
}

func SaveProject(c *gin.Context) {
	var input struct {
		Code         string `json:"code"`
		Name         string `json:"name"`
		DepartmentId int    `json:"department_id"`
		Owner        string `json:"owner"`
		Description  string `json:"description"`
		Enabled      *bool  `json:"enabled"`
	}
	if err := common.DecodeJson(c.Request.Body, &input); err != nil || input.Enabled == nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	project := model.Project{
		Code: input.Code, Name: input.Name, DepartmentId: input.DepartmentId,
		Owner: input.Owner, Description: input.Description, Enabled: *input.Enabled,
	}
	action := "project.create"
	if c.Request.Method == http.MethodPut {
		id, err := strconv.Atoi(c.Param("id"))
		if err != nil || id < 1 {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		project.Id = id
		action = "project.update"
	}
	before, err := model.SaveProject(&project)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			common.ApiErrorT(c, "Project does not exist")
			return
		}
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, action, map[string]any{
		"id": project.Id, "name": project.Name, "before": before, "after": project,
	})
	common.ApiSuccess(c, project)
}
